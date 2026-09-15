# Pinefrost desktop operations consoles

Two standalone Electron applications provide a local operator interface without changing the existing scheduled automation.

## Centegy Sync Console

Install this app on the Nairobi and Nyeri Centegy PCs. It displays the Smart sync and trigger-poll task state, starts or stops the Smart task, pauses or resumes both tasks, and runs a selected one-day Sales and Returns backfill.

1. Copy centegy-sync-console to a local folder on the PC.
2. Copy config.example.json to config.json and set the branch and projectPath for that PC.
3. Run npm install followed by npm run dist.
4. Run Create-Shortcut.ps1 from the installed app folder to create the branded desktop shortcut.

The person starting the console must have permission to manage the scheduled tasks. The normal scheduled runs continue hidden in the background.

## Server Export Console

Install this app on the Server PC. It shows the Nairobi and Nyeri export schedules plus newest staging and archive files, starts or stops one branch schedule, pauses or resumes the normal and boost schedules, and runs an export for a selected branch/date.

1. Copy server-export-console to a local folder on the Server PC.
2. Copy config.example.json to config.json and set pullerPath and the optional uploads/archive folders.
3. Run npm install followed by npm run dist.
4. Run Create-Shortcut.ps1 from the installed app folder to create the branded desktop shortcut.

Use the Export action only for the exact date that needs recovery. Its normal serial naming and archive checks remain handled by the established UKL puller script.
