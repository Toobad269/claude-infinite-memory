# Infinite Memory: ein Mod für Claude Code

Gibt Claude ein praktisch unendliches Kontextfenster. Claude entscheidet **selbst**, was aus dem Kontext
raus kann. Das landet als benannte Datei auf deinem PC (`~/.claude/infinite-memory/<name>.md`) und wird
beim nächsten Aufräumen aus dem Kontext entfernt. Braucht Claude es wieder, lädt es die Datei selbst.

## Installieren

In Claude Code (Terminal) eingeben:

```
/plugin install infinite-memory --marketplace Toobad269/claude-infinite-memory
```

Mit `y` bestätigen und den Scope mit Enter wählen. Danach ist der Mod sofort aktiv.

Aus einer Shell: `claude plugin install infinite-memory --marketplace Toobad269/claude-infinite-memory`

In der Desktop-App: auf **+** neben dem Eingabefeld klicken, dann **Plugins**, **Add marketplace** mit
`Toobad269/claude-infinite-memory` und danach **Add plugin**.

Bei einem privaten Repo braucht jeder, der installiert, Lesezugriff auf GitHub und Git-Zugangsdaten auf dem eigenen Rechner.

## Bedienung

- **`/gedaechtnis`** öffnet das Fenster in Claude. Dort siehst du die Kontextfüllung als Balken, alle
  Erinnerungen (mit Löschen-Knopf) und die Einstellungen:
  - **Modus** sparsam, normal oder aggressiv: wie oft Claude auslagert
  - **Schwelle** in Prozent: ab welcher Kontextfüllung aufgeräumt wird
  - **Auto-Aufräumen** an oder aus
  - **Jetzt aufräumen**
- Die **Statuszeile** zeigt `🧠 <Anzahl> Erinnerungen · Kontext <x>%`.

## So funktioniert es

| Werkzeug | Wer benutzt es | Was es tut |
|---|---|---|
| `merken(name, summary, content)` | Claude, selbstständig | speichert benannt auf dem PC und merkt den Inhalt zum Entfernen vor |
| `erinnerungen(suche)` | Claude | listet und durchsucht alle Einträge |
| `laden(name)` | Claude | holt einen Eintrag zurück in den Kontext |
| `vergessen(name)` | Claude | löscht einen Eintrag (Kopie bleibt im Ordner `papierkorb/`) |

- Claude bekommt im Systemprompt eine Anleitung, die Liste aller Erinnerungen und die aktuelle Kontextfüllung.
  Liegt die Füllung über der Schwelle, wird Claude aufgefordert, jetzt auszulagern.
- **Aufräumen:** Nach einer Antwort, wenn die Schwelle überschritten ist und etwas ausgelagert wurde,
  komprimiert der Mod den Kontext. Die ausgelagerten Themen schrumpfen dabei auf eine Zeile
  `[ausgelagert: <name>]`. Das gilt auch für `/compact` und die automatische Komprimierung.
- Eigene `.md`-Dateien, die du in den Ordner legst, findet Claude ebenfalls.

## Entwickeln

```
claude plugin validate .
claude plugin test .
```
