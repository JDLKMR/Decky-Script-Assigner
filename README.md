# Decky Profile Launcher
A Decky Loader plugin that assigns shell script paths to Steam launch options.

## Features
- Works with both Steam and non-Steam games (accounts for applying `%command%` to Steam games and filling the `Start In` field for non-Steam games)
- Can add multiple directories containing shell scripts, as well as a per-directory option to check subdirectories
- Can optionally add a button shortcut to game library pages that lets you add or remove a script assignment
- Ability to remove script paths from launch fields with a button
- Ability to manually scan for existing games with shell script paths
- Can exclude shell script-bound games from the list via keywords or patterns

## Building
```
npm install
npm run build
```

## AI Disclosure
All programming was done using Claude. Testing, documentation, and any other writing is all done by me.
