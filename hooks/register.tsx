import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Memory, Mode, Settings } from '../types'

const P = 'infinite-memory'
const PANE = 'infinite-memory'

const memories = atom({ plugin: 'infinite-memory', key: 'memories' } as const, [] as Memory[])
const DEFAULT_SETTINGS: Settings = { mode: 'normal', threshold: 60, autoClean: true, dir: '' }
const settings = atom({ plugin: 'infinite-memory', key: 'settings' } as const, DEFAULT_SETTINGS)
const fill = atom({ plugin: 'infinite-memory', key: 'fill' } as const, 0)
// Namen, die seit dem letzten Aufraeumen ausgelagert wurden und aus dem Kontext raus sollen
const pending = atom({ plugin: 'infinite-memory', key: 'pending' } as const, [] as string[])

const MODES: Record<Mode, string> = {
  sparsam: 'Lagere nur aus, wenn ein grosses Thema komplett abgeschlossen ist oder der Kontext fast voll ist.',
  normal: 'Lagere aus, sobald ein Teilthema abgeschlossen ist, vor einem Themenwechsel und immer, wenn der Kontext ueber dem Schwellwert liegt.',
  aggressiv: 'Lagere haeufig und kleinteilig aus: jede Erkenntnis, Entscheidung und jeden Zwischenstand, den du im naechsten Schritt nicht brauchst.',
}
const MODE_ORDER: Mode[] = ['sparsam', 'normal', 'aggressiv']

const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unbenannt'

// ---------- Einstellungen ----------
async function getSettings($: EngineInterface): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await read($, settings)) as Partial<Settings>) }
}

async function setSettings($: EngineInterface, fn: (s: Settings) => Settings) {
  const next = fn(await getSettings($))
  await update($, settings, () => next)
  await $.store.set('settings', next)
}

// ---------- Speicher auf dem PC ----------
async function dirOf($: EngineInterface): Promise<string> {
  const s = await getSettings($)
  if (s.dir) return s.dir
  const home: string = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '.'
  return `${home.replace(/[\\/]+$/, '')}/.claude/infinite-memory`
}
async function fileOf($: EngineInterface, name: string) {
  return `${await dirOf($)}/${slug(name)}.md`
}

async function saveIndex($: EngineInterface, list: Memory[]) {
  await update($, memories, () => list)
  await $.fs.write(`${await dirOf($)}/_index.json`, JSON.stringify(list, null, 2))
}

async function loadIndex($: EngineInterface) {
  const dir = await dirOf($)
  let list: Memory[] = []
  try {
    list = JSON.parse(await $.fs.read(`${dir}/_index.json`))
  } catch {
    list = []
  }
  // Dateien, die der Nutzer selbst in den Ordner gelegt hat, mit aufnehmen
  try {
    for (const f of await $.fs.list(dir)) {
      const name = f.name.replace(/\.md$/, '')
      if (f.kind === 'file' && f.name.endsWith('.md') && !list.some(m => m.name === name)) {
        list.push({ name, summary: '(vom Nutzer hinzugefuegt)', tags: [], saved: new Date(f.mtimeMs).toISOString(), size: f.size })
      }
    }
  } catch {
    /* Ordner existiert noch nicht */
  }
  list = list.filter(m => m.name)
  await update($, memories, () => list)
  return list
}

async function forget($: EngineInterface, raw: string) {
  const name = slug(raw)
  const path = await fileOf($, name)
  const body = await $.fs.read(path).catch(() => undefined)
  if (body === undefined) return `"${name}" gibt es nicht.`
  const dir = await dirOf($)
  await $.fs.write(`${dir}/papierkorb/${name}.md`, body)
  const isWin = /^[A-Za-z]:/.test(path) || path.includes('\\')
  await $.process
    .run(isWin ? ['cmd', '/c', 'del', '/q', path.replace(/\//g, '\\')] : ['rm', '-f', path])
    .catch(() => undefined)
  await saveIndex($, (await read($, memories)).filter(m => m.name !== name))
  return `"${name}" geloescht (Kopie in ${dir}/papierkorb).`
}



function cleanupInstructions(names: string[], extra?: string) {
  return `${extra ? extra + '\n\n' : ''}WICHTIG (Mod infinite-memory): Folgende Themen wurden bereits vollstaendig auf den PC ausgelagert: ${names.join(', ')}. ` +
  'Fasse ihre Details NICHT zusammen. Schreibe fuer jedes nur eine Zeile: "[ausgelagert: <name>] <ein Satz>", damit es spaeter mit laden(name) geholt werden kann. ' +
  'Behalte ausfuehrlich nur, was fuer die laufende Aufgabe noch gebraucht wird.'
}

export const register: Register = on => {
  // ---------- Die Werkzeuge, die Claude selbst benutzt ----------
  const TOOLS = [
    {
      name: 'merken',
      description:
        'Lagert einen Teil deines Kontexts dauerhaft auf den PC des Nutzers aus UND entfernt ihn beim naechsten Aufraeumen aus deinem Kontextfenster. ' +
        'Du entscheidest selbst, was raus kann: abgeschlossene Themen, lange Ausgaben, Recherchen, Zwischenstaende. ' +
        'Schreibe den Inhalt so vollstaendig, dass du ihn spaeter ohne heutigen Kontext verstehst (Pfade, Entscheidungen, Gruende, offene Punkte). ' +
        'Gleicher Name haengt an. Mit laden(name) holst du ihn jederzeit zurueck.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Kurzer, sprechender Name, z.B. "physik-engine-bugs"' },
          summary: { type: 'string', description: 'Ein Satz: worum es geht (bleibt im Kontext sichtbar)' },
          content: { type: 'string', description: 'Der vollstaendige Inhalt' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'summary', 'content'],
      },
      isDeferred: false,
    },
    {
      name: 'erinnerungen',
      description: 'Listet die ausgelagerten Erinnerungen auf (Name, Tags, Zusammenfassung), optional mit Volltextsuche.',
      inputSchema: { type: 'object', properties: { suche: { type: 'string' } } },
      isDeferred: false,
    },
    {
      name: 'laden',
      description: 'Laedt eine ausgelagerte Erinnerung vollstaendig zurueck in deinen Kontext.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      isDeferred: false,
    },
    {
      name: 'vergessen',
      description: 'Loescht eine veraltete Erinnerung (sie wandert in den Papierkorb-Ordner).',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      isDeferred: false,
    },
  ]

  on('session.start', async ($, e, next) => {
    const stored = (await $.store.get('settings')) as Partial<Settings> | undefined
    if (stored) await setSettings($, s => ({ ...s, ...stored }))
    await loadIndex($)
    for (const t of TOOLS) await $.tool.register(t)
    await $.command.register({ name: 'gedaechtnis', description: 'Infinite Memory: Erinnerungen und Einstellungen anzeigen' })
    return next(e)
  })

  on('command.run', { command: 'gedaechtnis' }, async $ => {
    await loadIndex($)
    await $.ui.open({ id: PANE, title: 'Infinite Memory' })
    return { text: 'Infinite-Memory-Fenster geoeffnet.' }
  })

  on('tool.call', { tool: 'mcp__infinite-memory__merken' }, async ($, e: any) => {
    const a = e.input ?? e
    const name = slug(String(a.name ?? ''))
    const summary = String(a.summary ?? '').replace(/\s+/g, ' ').trim()
    const tags: string[] = Array.isArray(a.tags) ? a.tags.map(String) : []
    const now = new Date(await $.clock.now()).toISOString()
    const path = await fileOf($, name)
    let text = `---\nname: ${name}\nsummary: ${summary}\ntags: ${tags.join(', ')}\nsaved: ${now}\n---\n\n${a.content}`
    if (await $.fs.exists(path)) {
      text = `${await $.fs.read(path)}\n\n<!-- Nachtrag ${now} -->\n${a.content}`
    }
    await $.fs.write(path, text)
    const list = (await read($, memories)).filter(m => m.name !== name)
    await saveIndex($, [{ name, summary, tags, saved: now, size: text.length }, ...list])
    await update($, pending, p => [...new Set([...p, name])])
    $.ui.toast(`Ausgelagert: ${name}`)
    return {
      result: `Gespeichert als "${name}" (${path}). Der Inhalt wird beim naechsten Aufraeumen aus deinem Kontext entfernt; mit laden("${name}") holst du ihn zurueck.`,
    }
  }).catch(($, e, next) => (next.called ? next(e) : { result: 'Fehler im infinite-memory-Mod, bitte erneut versuchen.' }))

  on('tool.call', { tool: 'mcp__infinite-memory__erinnerungen' }, async ($, e: any) => {
    const q = String((e.input ?? e).suche ?? '').toLowerCase()
    const list = await loadIndex($)
    const hits: Memory[] = []
    for (const m of list) {
      if (!q) hits.push(m)
      else if (`${m.name} ${m.summary} ${m.tags.join(' ')}`.toLowerCase().includes(q)) hits.push(m)
      else {
        const body = await $.fs.read(await fileOf($, m.name)).catch(() => '')
        if (body.toLowerCase().includes(q)) hits.push(m)
      }
    }
    return {
      result: hits.length
        ? hits.map(m => `- ${m.name} [${m.tags.join(', ')}] (${m.saved.slice(0, 16)}): ${m.summary}`).join('\n')
        : 'Keine Erinnerungen gefunden.',
    }
  }).catch(($, e, next) => (next.called ? next(e) : { result: 'Fehler im infinite-memory-Mod, bitte erneut versuchen.' }))

  on('tool.call', { tool: 'mcp__infinite-memory__laden' }, async ($, e: any) => {
    const name = slug(String((e.input ?? e).name ?? ''))
    const body = await $.fs.read(await fileOf($, name)).catch(() => undefined)
    if (body === undefined) {
      const names = (await read($, memories)).map(m => m.name).join(', ')
      return { result: `"${name}" gibt es nicht. Vorhanden: ${names || '(keine)'}` }
    }
    return { result: body }
  }).catch(($, e, next) => (next.called ? next(e) : { result: 'Fehler im infinite-memory-Mod, bitte erneut versuchen.' }))

  on('tool.call', { tool: 'mcp__infinite-memory__vergessen' }, async ($, e: any) => ({ result: await forget($, String((e.input ?? e).name ?? '')) })).catch(($, e, next) => (next.called ? next(e) : { result: 'Fehler im infinite-memory-Mod, bitte erneut versuchen.' }))

  // ---------- Claude erklaeren, wie es funktioniert (Systemprompt) ----------
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    const s = await getSettings($)
    const list = await read($, memories)
    const pct = await read($, fill)
    const index = list.length
      ? list.slice(0, 60).map(m => `- ${m.name}: ${m.summary}`).join('\n') + (list.length > 60 ? `\n... und ${list.length - 60} weitere (erinnerungen)` : '')
      : '(noch keine)'
    const warn =
      pct >= s.threshold
        ? `\n\nACHTUNG: Dein Kontext ist zu ${pct}% gefuellt (Schwellwert ${s.threshold}%). Lagere JETZT abgeschlossene Themen mit merken aus.`
        : ''
    const text = `# Unendliches Gedaechtnis (Mod "infinite-memory")
Dein Kontextfenster ist begrenzt, dein Gedaechtnis nicht. Mit den Werkzeugen merken, erinnerungen, laden und vergessen verwaltest du ein dauerhaftes Gedaechtnis auf dem PC des Nutzers.
- Du entscheidest selbst, was aus dem Kontext raus kann. ${MODES[s.mode]}
- Was du mit merken auslagerst, wird beim naechsten Aufraeumen aus dem Kontext entfernt und durch einen Verweis auf den Namen ersetzt.
- Bevor du sagst, dass du etwas nicht weisst, pruefe die Liste unten und lade passende Eintraege mit laden.
- Loesche eindeutig veraltete Eintraege mit vergessen.
Aktuelle Kontextfuellung: ${pct}%.

Ausgelagerte Erinnerungen:
${index}${warn}`
    return { ...out, sections: [...out.sections, { id: `${P}:anleitung`, text, scope: 'session' as const }] }
  })

  // ---------- Aufraeumen: Ausgelagertes wirklich aus dem Kontext entfernen ----------
  on('session.compact', async ($, e, next) => {
    if (e.agentId) return next(e)
    const names = await read($, pending)
    const all = (await read($, memories)).map(m => m.name)
    const result = await next({ ...e, instructions: cleanupInstructions(names.length ? names : all.slice(0, 40), e.instructions) })
    if (!result.skip && e.trigger !== 'precompute') await update($, pending, () => [])
    return result
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    if (e.context.percent !== undefined) await update($, fill, () => e.context.percent ?? 0)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if ((e as any).agentId) return done
    const s = await getSettings($)
    const usage = await $.session.usage().catch(() => undefined)
    const pct = usage?.context?.percent ?? (await read($, fill))
    await update($, fill, () => pct)
    const names = await read($, pending)
    if (s.autoClean && names.length && pct >= s.threshold) {
      // compact laeuft nur zwischen Turns, darum kurz warten
      $.clock.after(800, async () => {
        const r = await $.session.compact({}).catch(() => undefined)
        if (r && !r.skip) $.ui.toast(`Kontext aufgeraeumt: ${names.length} Thema/Themen ausgelagert`)
      })
    }
    return done
  })

  // ---------- Statuszeile ----------
  on('turn.start', async ($, e, next) => {
    const n = (await read($, memories)).length
    $.ui.status(`🧠 ${n} Erinnerungen · Kontext ${await read($, fill)}%`)
    return next(e)
  })

  // ---------- Die Oberflaeche (/gedaechtnis) ----------
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await getSettings($)
    const list = await read($, memories)
    const pct = await read($, fill)
    const names = await read($, pending)
    const width = 20
    const bar = '█'.repeat(Math.round((pct / 100) * width)) + '░'.repeat(width - Math.round((pct / 100) * width))
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 16)

    return (
      <Box flexDirection="column">
        <Text bold>Kontext {bar} {pct}%  (Aufraeumen ab {s.threshold}%)</Text>
        <Text dimColor>Speicherort: {await dirOf($)}</Text>
        <Text dimColor>Wartet aufs Aufraeumen: {names.length ? names.join(', ') : '-'}</Text>
        <Text> </Text>
        <Text bold>Einstellungen</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="mode" onPress={() => setSettings($, x => ({ ...x, mode: MODE_ORDER[(MODE_ORDER.indexOf(x.mode) + 1) % 3] ?? 'normal' }))}>
            Modus: {s.mode}
          </Button>
          <Button key="minus" onPress={() => setSettings($, x => ({ ...x, threshold: Math.max(20, x.threshold - 10) }))}>Schwelle -10</Button>
          <Button key="plus" onPress={() => setSettings($, x => ({ ...x, threshold: Math.min(95, x.threshold + 10) }))}>Schwelle +10</Button>
          <Button key="auto" onPress={() => setSettings($, x => ({ ...x, autoClean: !x.autoClean }))}>
            Auto-Aufraeumen: {s.autoClean ? 'an' : 'aus'}
          </Button>
        </Box>
        <Text dimColor>{MODES[s.mode]}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="clean" variant="primary" onPress={() => $.session.compact({}).catch(() => $.ui.toast('Geht nur zwischen zwei Antworten.'))}>
            Jetzt aufraeumen
          </Button>
          <Button key="refresh" onPress={() => loadIndex($)}>Aktualisieren</Button>
          <Button key="close" role="dismiss" onPress={() => $.ui.close({ id: PANE })}>Schliessen</Button>
        </Box>
        <Text> </Text>
        <Text bold>Erinnerungen ({list.length})</Text>
        {list.length === 0 && <Text dimColor>Noch keine. Claude legt sie selbst an.</Text>}
        {list.slice(0, room).map(m => (
          <Box key={m.name} flexDirection="row" gap={1}>
            <Button key={`del-${m.name}`} onPress={() => forget($, m.name).then(t => $.ui.toast(t))}>Loeschen</Button>
            <Text>
              <Text bold>{m.name}</Text> <Text dimColor>{m.saved.slice(0, 10)}</Text> {m.summary}
            </Text>
          </Box>
        ))}
        {list.length > room && <Text dimColor>... und {list.length - room} weitere</Text>}
      </Box>
    )
  })
}
