# Game Apples Block

The `game-apples` CRM code block renders a colorful, drag-and-drop mini-game where
kids catch falling apples and drop them into a basket. It works on desktop and
mobile, supports audio/vibration feedback, and tracks the best scores inside the
note's frontmatter.

## Embedding the block in a note

Add a fenced code block with the `crm` language and set its identifier to
`game-apples`. You can pass options inline after a `?` query string, in YAML, or
combine both styles just like other CRM blocks.

````
```crm
game-apples?duration=60&heptic=both
```
````

- `duration` controls the round length in seconds (minimum 5 seconds, default 60).
- `heptic` chooses the default feedback mode (`audio`, `vibration`, `both`, or `none`).
  When set to `none` the game starts muted; players can still toggle sound in the
  in-game menu.

When the block is idle it shows a playful “play” button in the note. Tapping the
button opens the game in full screen. Exit with the **X** icon in the top-right
corner.

## Sound and vibration

The game exposes an in-game sound toggle (bottom-right). Its state persists to the
note so players do not need to mute the game every time. You can also preconfigure
the default state by editing the note’s frontmatter:

```yaml
---
gameApples:
  sound: off   # off, mute → muted by default; anything else → sound on
---
```

With sound enabled and `heptic` not set to `none`, the game plays cues while
grabbing apples, dropping them in the basket, or missing the target. Devices that
support vibration will also buzz when the `heptic` mode allows it.

## Leaderboard storage

Each completed round records the score (number of apples safely dropped in the
basket) with the current date. The top 10 results are kept in the note’s
frontmatter and the three best results appear on the play button overlay so you can
celebrate recent wins at a glance.

Frontmatter records look like this:

```yaml
---
gameApples:
  sound: on
  scores:
    - score: 18
      date: 2024-03-09
      recordedAt: 2024-03-09T16:42:03.215Z
    - score: 15
      date: 2024-03-05
      recordedAt: 2024-03-05T11:10:44.002Z
---
```

You do not need to create the section manually; the plugin updates it whenever a
round finishes or the sound toggle changes.

## Tips

- Try shorter `duration` values (e.g., 30 seconds) for quick bursts of play.
- Use `heptic=sound` when you want audio cues without vibrations.
- Encourage replay by glancing at the leaderboard preview on the note’s play button.
