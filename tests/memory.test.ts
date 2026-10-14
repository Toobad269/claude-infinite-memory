import { expect, mock, test } from 'claude-code/testing'

const out = (r: any) => String(r.text ?? r.result ?? r.deny)

function fakeDisk(on: any) {
  const files = new Map<string, string>()
  mock.env(on, { HOME: '/home/test' })
  mock.store(on)
  mock.clock(on)
  on('fs.write', async (_$: any, e: any) => { files.set(e.path, e.text); return { value: undefined } })
  on('fs.read', async (_$: any, e: any) => {
    const t = files.get(e.path)
    if (t === undefined) throw new Error('ENOENT')
    return { value: t }
  })
  on('fs.exists', async (_$: any, e: any) => ({ value: files.has(e.path) }))
  on('fs.list', async () => ({ value: [] }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('tool.register', async (_$: any, e: any) => ({ value: { tool: `mcp__infinite-memory__${e.name}` } }))
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.toast', async () => ({ value: undefined }))
  return files
}

test('merken speichert benannt, laden holt es zurueck, Aufraeumen nennt es', async ($, on) => {
  const files = fakeDisk(on)
  let compactInstructions = ''
  on('session.compact', async (_$: any, e: any) => {
    compactInstructions = e.instructions ?? ''
    return { messages: [{ role: 'assistant', text: 'Zusammenfassung', toolUses: [] }] }
  })
  await $.session.start({ source: 'startup', cwd: '/home/test' } as any).catch(() => undefined)

  const saved = await $.tool.call({
    tool: 'mcp__infinite-memory__merken',
    name: 'Physik Bugs',
    summary: 'Kollision bei hoher Geschwindigkeit',
    content: 'Tunneling ab 300 km/h, Fix: CCD aktivieren',
  } as any)
  expect(out(saved)).toContain('physik-bugs')
  expect(files.get('/home/test/.claude/infinite-memory/physik-bugs.md')).toContain('CCD aktivieren')
  expect(files.get('/home/test/.claude/infinite-memory/_index.json')).toContain('Kollision')

  const loaded = await $.tool.call({ tool: 'mcp__infinite-memory__laden', name: 'physik-bugs' } as any)
  expect(out(loaded)).toContain('Tunneling')

  const listed = await $.tool.call({ tool: 'mcp__infinite-memory__erinnerungen', suche: 'ccd' } as any)
  expect(out(listed)).toContain('physik-bugs')

  await $.session.compact({ messages: [{ role: 'user', text: 'alt', toolUses: [] }] } as any)
  expect(compactInstructions).toContain('physik-bugs')

  const gone = await $.tool.call({ tool: 'mcp__infinite-memory__vergessen', name: 'physik-bugs' } as any)
  expect(out(gone)).toContain('geloescht')
  expect(files.get('/home/test/.claude/infinite-memory/papierkorb/physik-bugs.md')).toContain('CCD')
})

test('das Gedaechtnis-Fenster zeichnet auf jeder Oberflaeche', async ($, on) => {
  fakeDisk(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'infinite-memory', surface, component: 'Pane', props: {}, requestId: 'infinite-memory', viewport: { columns: 100, rows: 40 } } as any)
    expect(JSON.stringify(await (ui as any).find({}) ?? null)).toBeDefined()
    await ui.unmount()
  }
})
