# AI Games

A collection of games, each in its own folder.

## Games

- [Fragline](fragline/README.md): a browser FPS with multiplayer, bots, and co-op zombie holdout.

### Run Fragline

Install Node.js, then run:

```sh
cd fragline
npm ci
npm start
```

Open http://localhost:3000. Run `npm test` from the same folder to run the tests.

## Backups

Original source snapshots are preserved separately from the current game:

- [Before holdout](backups/fragline/pre-holdout/)
- [Before phase 3](backups/fragline/pre-phase3/)

Each backup is a standalone project: run `npm ci` and `npm start` inside its folder.
Installed dependencies, runtime logs, and local tool settings are excluded.
Use Git commits and tags to preserve future versions.

## Adding another game

Create a new folder at the repository root with that game's source, dependencies,
and README. Keep each game's install, run, and test commands in its own folder.
