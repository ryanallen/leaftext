# Agents in detail

> Everything about running AI agents in Leaftext, one fact at a time

This page holds the full behavior behind [Your own AI agent in Leaftext](../01-features/10-agents.md). Each section matches a section there.

## Run the agent in a console

### Starting an agent

- Open a [console in the library](../01-features/03-library.md#console) and type the agent's ordinary command. It uses its own model address, model choice and credentials.
- Leaftext has no model address or key field, and never makes the model request itself. Set those in the agent's own configuration.
- Or press **New** at the top of the library pane. Each account is its own row: the agent's logo, then the name you gave it.
- Drag a row up or down to order the agents; the order is kept across restarts. One press starts that account.
- Leaftext lets your terminal run its own startup files, then starts the agent in a new console in the folder named under **New page**.
- **Starts in** names that folder: the library's own when the **+** opens. Press it to start somewhere else without moving the library.
- That opens a sheet beside the **+** shaped like the vault picker: your vaults on the left, the folder's path, **Start here**, **Choose another folder…** and its folders on the right.
- A vault shows its folder, a folder steps in, and a step of the path steps back out. **Choose another folder…** opens the system's folder window.
- The console, every agent row and **Compare agents** then start there.
- The console's row names the account it started under. Press that name to rename it. **Prompts skipped** shows where you chose to skip prompts.

### An account's settings

The settings button beside each row opens that account's own view in the same menu.

- **Rename** changes only the name you see.
- The agent's own setup, whatever your terminal already signs in with, is a row too. It is named after the agent until you rename it, and is left out where an account already uses that folder.
- **Skip permission prompts** starts every account of that agent without asking before each action. For Codex it also turns off the sandbox.
- That choice is remembered for the next start and never changes a console already running.
- **Launch settings** belong to one account: how it signs in, which terminal's setup is read, and an optional launch command of your own.
- An optional **key command** runs before each start and prints the account's connection settings as JSON, such as a key and an HTTPS address.
- Only the settings that agent reads for its connection are taken from that answer. The answer is never shown or saved.
- **Connections** shows what the account is connected to, with no console open.
- **Services** are your wisp's own rows: Linear, Slack, Discord and, on a Mac, iMessage. They use the same keys in the system's credential store as [your wisp's sheet](../01-features/05-settings.md#your-wisp).
- **Tool servers** are the agent's own, as it lists them, each with whether it answered and a **Remove**. **Add tool server…** takes a name and a command line or address.
- Claude Code and Codex add and remove tool servers with their own commands, so their settings stay in their own spelling.
- An Antigravity profile's tool servers are written into its own file, leaving every other entry as it was.
- Leaftext's own tool server is listed and cannot be removed here, because every console needs it.
- **Remove from list** leaves the folder, its sign-in and any console using it as they are.

### Your wisp on an account

- Any account can run [your wisp](../01-features/05-settings.md#your-wisp). Choose it under **Runs on** on the wisp's sheet, with its **Model** and **Effort**, and a folder under **Works in**.
- Press the wisp's row to talk to it. Its chat is that account's own console, titled with the wisp's name, and its agent is told it is your wisp.
- The wisp's row stays selected while its chat is in front. Its chats are listed under it, newest first.
- Press an earlier chat to pick it up again as the wisp. **New chat** starts a fresh conversation.
- **Close** stops the chat in front and leaves the wisp and its chats as they are. Use it when the wisp's agent is stuck on a screen of its own.
- Given a Slack or Discord token, the wisp answers you there the same way. On a Mac it answers your iMessages too.
- For iMessage the wisp needs an Apple ID of its own, signed into Messages on the Mac. Texting the Apple ID Messages already uses would bring its answers back as your own.
- **How to set up iMessage** on the **iMessage** row walks through making that account, verifying its email and signing Messages in, with a button to each place.
- Then name your own phone number or Apple ID on the row, press **Let Leaftext read Messages**, and turn Leaftext on under Full Disk Access.
- A text from that number then reaches the wisp with no @ and no command word. Its answer comes back in the same Messages conversation.
- Nobody else who texts the Mac is answered. **Check everything** sends you a one-line test message.

### Adding an account

- **Add account** sits at the foot of the list. Pick the agent and name the account.
- For Claude or Codex, Leaftext makes a new, empty account folder and opens the agent's own sign-in in a new console.
- **Use existing account folder…** adds a folder you already sign in with, copying nothing out of it.
- Every Claude or Codex sign-in already in your home folder is listed under the email it signs in as. One you remove stays off the list.
- Each account keeps its own sign-in and history, so two can run side by side.
- An Antigravity account is a profile: its own folder of history, settings, plugins and tool servers.
- On Windows, Antigravity keeps one Google sign-in for the whole computer, so every profile shares it.
- On a Mac, each Antigravity profile signs in to Google on its own the first time it starts, and its view opens that profile's sign-in.

### Dropping a path

- Drag a file, picture or folder from the library, Explorer or Finder onto a console to type its full path into the line you are writing.
- Pick several library rows to insert their paths together. The console lights while it can take the drop.
- Paths are quoted and followed by a space so you can keep typing. Dropping never sends the line or moves the file.
- This also works in a console's own window. When the console shows a message box, the path goes into that box at the cursor and keeps your draft.

### What the agent loads

- The agent keeps everything it loads in an ordinary terminal: the project's rules, its skills, its hooks and its plugins.
- Leaftext starts your own shell in the library's folder with your own environment. Each skill is there and each hook runs once, as it would elsewhere.
- The [Leaftext plugin](#install-the-plugin) adds its document tools beside your other plugins without replacing any.
- Remote tool servers, such as a company's own, are set up in the agent's own settings and work in a Leaftext console the same as anywhere.
- The `mcp.json` file in Leaftext's settings folder is not passed to an agent you run in a console.

### A console's name

- With the plugin installed, Codex and Claude consoles use the conversation title the agent saved, on its row in **All chats**. This works when the agent's own terminal title is off.
- Until a hook can read that title, the console reads the first five words of the prompt. The skill, a pasted-picture placeholder and path folders are left out.
- An agent can name its console through `leaftext_name`, which wins over the automatic title. Point at the tab or row to read the original prompt.
- `/clear`, `/new`, `/reset`, switching conversations or leaving the agent clears the name. Other agents keep their own terminal titles and the prompt fallback.

### Working, done and needs you

- While Codex or Antigravity reports **Working** on its row, the row keeps its working glow as you type in the terminal or send from the chat box.
- When the agent reports **Done** or **Needs you**, the tab follows, including after the tab strip is redrawn.
- Codex also shows **Needs you** when it refuses the plugin's hooks after the plugin changed. Open `/hooks` in Codex to review and trust them.
- The next completed turn reads **Done** once the hooks run without a refusal.
- On Windows, trusting changed Codex hooks reconnects that console to the same conversation. The row reads **Working** while it reconnects.
- The next message waits in the box until Codex can take it. A failed reconnect reads **Needs you** and keeps those words in the box.

### Notices

- When an agent turns **Done** or **Needs you** while its window is behind another program, a system notice names it and says **Finished** or **Is asking for you**.
- On Windows it is a notification. On a Mac it is a banner with one bounce of the Dock icon and a badge counting the notices still standing.
- On a Mac, the first notice asks macOS whether Leaftext may show notifications.
- Pressing a notice brings that console's window forward with its tab in front. Looking at the console takes the notice back.
- **Tell me when an agent is done or asking**, a switch on the **+** menu, turns notices off and on. It is remembered across launches.

## The conversation as a chat

### What the chat shows

- While Claude Code, Codex or Antigravity sits at its prompt or works on an answer, the console shows the conversation as a chat.
- What you sent sits in a bubble on the right. The agent's answer is plain text on the left, with its opening lines above the first message.
- The chat is drawn from the session record the agent writes as it works. Every turn stays as it was sent and answered, however far the terminal scrolls.
- Until the agent names its record, the chat reads the terminal's screen.
- While Codex streams an answer, the chat and message box stay visible through redraws.
- The tools the agent ran, and what it said along the way, fold under its **Worked for** line. A command that failed says so. Press the line to open them.
- Tables, banners and boxes keep the terminal's own lettering. Web addresses open through Leaftext.

### Diffs

- Every edit the agent makes to a file is drawn as a diff: the file's name, its removed lines in red and its added lines in green.
- Long lines wrap inside the diff, so the chat scrolls when you wheel over it.
- A change that is only formatting is left out of the diff and counted in its header instead.
- In Markdown, formatting means a paragraph re-wrapped, a list re-marked or a table re-padded. In JSON and YAML, keys re-indented or re-quoted.
- In code it means a re-indent or a formatter's run, a string's quotes, a trailing comma, or a statement's last semicolon. This covers TypeScript, JavaScript, Rust, Python, HTML and CSS.
- So a re-wrapped paragraph with one word changed shows only that word. An edit that changed nothing else reads as one **formatting only** row.
- A hunk inside a Markdown code block is always compared as lines.
- A **⋯ unchanged lines** row opens twenty lines at a press, from the side nearest the edit, and counts what is left.
- Between two edits it reads those lines from the file, and says **The file has changed since this edit** where the file no longer matches.
- A block the agent moved is drawn once, with **↕ moved from line** and **↕ moved to line** notes at its two ends.
- That holds whether it moved in one edit or in two edits of one file in one turn. The header counts it as a move, not as lines removed and added.
- Press either move note to bring the other into view. **Hide moves** on the card hides the move's notes and lines.
- The header ends in one word for the most serious change the card holds: **identical**, **formatting**, **comments**, **moved** or **logic**.
- **logic** wears the header's own color and the rest are muted, so a long turn can be skimmed for edits that change behavior.

### Messages while the agent works

- A message sent while Claude Code is still working waits as a dashed bubble under the running turn. It becomes a turn of its own once Claude Code takes it.
- In Codex, a message sent while your last one still sits in Codex's input line stays in the box with **Wait for your last message to go in.**
- That keeps two messages from running together. Send it again once the first has gone in.
- A waiting message carries **Send now** beside its **Waiting** note, with its key. Press it, or `Ctrl+S` (`Cmd+S` on a Mac), and the agent takes it at once.

### Moving through a long chat

- Once a prompt's bubble scrolls off the top, the prompt is held at the chat's top edge while you read its answer. Press it to scroll back to its bubble.
- With more than one prompt sent, **Previous prompt** and **Next prompt** arrows step between them, showing where you are, such as **2 of 3**.
- Point at an answer to copy it.

### The message box

- At the foot, a message box stands in place of the agent's own input line. Enter sends; `Shift+Enter` starts a new line.
- What you type is sent as typed. Straight quotes and two hyphens stay as they are, and the box does not underline spelling.
- Escape empties the box, and `Ctrl+Z` (`Cmd+Z` on a Mac) brings the words back.
- While the agent works, the round button stops it, and so does Escape once the box is empty.
- Up in an empty box brings back what you sent before.
- While Claude Code holds messages waiting behind its turn, the box says so. Up brings them into Claude Code's own line to edit, and Enter puts them back in line.
- Clicking on the conversation leaves the keys in the box, unless the click highlighted words to copy.
- **+** attaches a file, and a pasted picture rides along too, each as its path. Nothing is put on a message you did not put there yourself.
- An open document goes only when you attach it. The file window stands over the Leaftext window that asked; on a Mac it is a sheet.
- While the file window is open, every console keeps drawing, agents keep answering, and your other Leaftext windows work as usual.
- `@` at the start of a word picks a file from the console's folder, one folder at a time.
- The **$** button in Codex opens its local skills and apps. The **/** button in Claude opens its local commands and skills.
- Those buttons keep any draft as arguments and send nothing until you press Enter.
- Type `/` at the start of the box to list commands, or `$` in Codex to list skills and apps. Keep typing to narrow the list.
- Move with Up and Down, and choose with Tab, Enter or a click. Escape closes the list and keeps your words.
- A recognized name takes the theme's action color. A name typed in full sends on the first Enter.
- Slash commands and Codex skills carry attached files after their words.
- The microphone starts the system's own dictation: Windows voice typing, or dictation on a Mac. The words land in the box unsent.
- On Windows, dictation starts only while the Leaftext window is in front.
- For Claude Code, the box shows its permission mode. Press it, or `Shift+Tab`, to step to the next mode.
- Beside it sit the notes Claude Code shows under its own input line: a background shell still running, such as `1 shell`, and a stop hook that failed.
- For Codex, the box shows its permissions, which opens Codex's own list.

### When the terminal comes back

- Whenever the agent shows something of its own, the chat steps aside and the terminal comes back with the keys. That covers a question before a command, a list, a sign-in or a picker.
- Typing into the agent's own line does the same. Answer there, and the chat returns when the agent is back at its prompt, with your draft still in the box.
- Other agents and ordinary shells always show the terminal.
- So does Antigravity while it works with no session record named, as it does where the Leaftext plugin is not installed for it.
- **Chat** and **Console** stand in the [floating toolbar](../01-features/02-navigation.md#the-floating-toolbar) whenever the console holds Claude Code, Codex or Antigravity.
- **Console** takes the chat away and gives you the terminal at any moment, working or not. It stays until you press **Chat**.
- The lit button is what is on screen: **Console** whenever the terminal shows, whatever put it there, and **Chat** only while the chat stands. Pressing **Chat** while the agent is showing something of its own leaves the terminal up and says what it is waiting on.
- The chat stands however narrow its column, even when Codex wraps its status line over several rows.
- Each console keeps its own choice, so a chat that has gone wrong never locks you out of your agent.
- A console or past chat standing beside a document keeps **Chat** and **Console** in a bar of its own under that column.
- On a past chat, **Console** starts its agent and opens on the terminal.

### The More menu

- The three dots after **/** in the message box, **More**, open Rules, Tools, History, Saved, Repeat, Fork, Rewind and Side question.
- **Rules** lists the rules files the agent reads — `CLAUDE.md` for Claude Code, `AGENTS.md` for Codex — in the console's folder and each folder above it, nearest first.
- A row opens its file in a tab. With none, **Make CLAUDE.md here** writes an empty one and opens it.
- **Tools** lists the tool servers the agent is connected to, each with its tool count where the agent says. A failed one shows in the warning color with the agent's own words.
- **History** searches the prompts sent before to Claude Code, Codex and Antigravity on this machine, those from this console's folder first.
- **Saved** lists the prompts you keep, each a `##` heading in a note beside your settings. **Edit the list…** opens that note.
- Choosing a prompt from either puts it in the box whole, waiting for you to send it.

### Repeat

- **Repeat** sends what is in the box again on a timer: **5 minutes**, **10 minutes**, **30 minutes** or **Hour**. On Claude Code there is also **Let Claude pick the pace**.
- Claude Code takes a repeat as its own `/loop` and keeps the timer itself.
- For Codex and Antigravity, Leaftext sends the prompt at once and again at each interval. A turn goes by while the agent is working or while you have words in the box.
- A chip beside **More** says how often and when next. Press it to stop the repeat.
- A repeat ends when its console closes, and does not come back after a restart.
- **At a time of day…**, the last row, sends at a clock time instead, on every agent. Choose **Every day**, **Weekdays**, **Weekends**, the days themselves, or **Once**.
- Choose whether each run goes **In this chat** or **In a new chat each time**, then press **Set** or Enter.
- Leaftext keeps that clock itself, for Claude Code too. A run that comes due while the agent works is sent as soon as it rests.
- A run in a new chat starts the same agent beside the page and sends the prompt once it is ready. The chip says the schedule and when it runs next.

### Usage limits and staying awake

- When Claude Code or Codex reports its 5-hour or weekly limit at 99% or more, a message you send is not typed in.
- A note over the box names the limit and when it resets, with **Send at** that time and **Send anyway**.
- **Send at** leaves the words in the box and sends them once the limit resets and the agent is at rest. The chip reads **Sends at** and the time.
- Press the chip, or empty the box, to let it go.
- While any console's agent is working, Leaftext keeps the computer awake so its sleep timer cannot stop the turn. The screen may still turn off.
- The hold ends the moment no agent is working or the window closes.

### Side questions

- **Side question** in **More** puts `/btw ` at the front of the box. Its row shows a check, and choosing it again takes it off.
- Type the question and send it. Claude Code, Codex and Antigravity each answer on the side and leave the conversation as it was.
- While the answer stands, it takes the whole view, with a **Close side question** button. Press it to bring the chat back.
- The side question and its answer stay out of the conversation.
- Codex takes a side question only once its conversation has started. Before your first message, the row says to send one first.
- While a console shows the terminal instead of the chat, as for a whole Antigravity turn on Windows, the context ring offers **Ask a side question**.
- That ring stays pressable while the agent works, with its other commands grayed until it finishes.

### Saved conversations

- Leaftext can keep every conversation your agents have, but nothing asks you to. Open **Saved conversations** from the **⋯** button at the foot of the side bar.
- An agent's row in the **New** menu offers the same as **Save sessions**.
- While saving was never set up, a window of four screens walks you through it. **Next** moves on and **Back** returns.
- The first screen lists each agent found, its accounts, and how many earlier conversations it has. Untick an agent to leave it out.
- The second asks where: **Inside Leaftext**, or **In a folder you can open**, filled in as `Documents\Leaftext Sessions` on Windows and `~/Leaftext Sessions` on a Mac.
- The third asks what to keep: what the agent thought, everything its tools printed, and the earlier conversations. All are recommended and ticked.
- Saving carries on while you keep working, the count showing beside **Conversations** until it is done.
- The last screen names where they are kept. Inside Leaftext they are one compressed file in the app's data, and it says how much room that takes.
- In a folder, it names the folder with **Show in Explorer**, or **Show in Finder** on a Mac.
- Nothing is kept until the third screen is answered. **Cancel** closes the window with nothing kept.
- Each account gets its own place: the agent's own setup is named **Main**, and every other account by its name in the New menu.
- Each time an agent comes to rest, its session is kept as a note: the prompt, the thinking, every tool with its whole output, and the replies.
- Pages for each project and each day list those notes.
- In a folder, the notes sit under the agent and the account, beside the agent's own record copied untouched.
- Every turn that wrote a file also gets a decision record under `decisions/`: its prompt, the agent's thinking, what the checks said, and the commit that later carried the change.
- Every file it wrote gets a page under `files/` listing those records newest first, so a file can be followed back to why it changed.
- Later, **Saved conversations** names where they are kept and offers four actions.
- **Open them** opens every conversation by project and by day. Kept inside Leaftext, they open from a reading copy in the temporary folder, which the next launch removes.
- **Export to a folder…** writes the same notes into a folder you choose, one subfolder per account.
- **Change where and what** walks the screens again. Switching place moves every saved conversation, removing it from the first place only once each copy reads back whole.
- **Stop saving and delete everything** asks once, then keeps nothing more and removes what was kept.
- Inside Leaftext that removes the whole file. In a folder it removes only the notes and pages Leaftext wrote there.
- Your agents keep their own history as they always have. **Saved conversations** starts from the first screen when you want saving back.
- A tool's output can hold anything it printed, so only you should open where these are kept.

## Fork and compare

- Under each finished turn, beside **Worked for** and Copy, **N files changed** lists the files the agent's edit tools wrote that turn, in the order first written.
- **Open** opens a file in a tab beside the console. **Diff** scrolls the chat to that file's first edit.
- A file written by a shell command is not listed.
- **Fork**, in **More** on a Claude Code or Codex message box while the agent is at rest, copies the conversation into a new console beside the first.
- The fork uses the same account and folder. Each console then goes on with its own answers and record, and the first is left as it was.
- Antigravity has no fork.
- **Compare agents** in the **+** menu sends one prompt to two agents side by side. Type the prompt, pick the two agents, and press **Send to both**.
- Claude Code and Codex are picked at first. Both open in the folder the **+** menu names, in the two halves of a split.
- Each is sent the prompt once its agent is ready.

## The agent's status under its console

### The status row

- A row appears under a console as soon as Leaftext recognizes Claude Code, Codex or Antigravity.
- On the left: the agent's logo, the account name, the model, and the effort as one letter.
- On the right: three rings for context, the shorter usage limit and the weekly limit, each filling with what is used.
- Point at a ring for the whole reading, such as **Context: 28k of 258k used (11%)** or **5-hour limit: 17% used, resets in 14m**.
- Point at the logo for the agent's name, the cost, and whether prompts are skipped.
- These controls work without the plugin. The model and effort are grayed while the agent works.
- With the plugin, the row also shows what the session reports: Codex's model, context and limits, or Claude Code's and Antigravity's model and tokens used.
- A figure the session never reported is left out. Until a figure arrives, its button keeps the neutral label.
- A reported context capacity appears in the ring's reading before usage arrives, with the ring left empty.
- On a narrow console, the weekly ring goes first, then the shorter limit's ring, then the account name, the effort button and the folder button.

### The account name

- Claude Code and Codex report which account folder they use. Its name appears after the logo: **Default account**, or the folder name for another account.
- Press the name to rename it in Leaftext. Enter or leaving the field saves; Escape cancels. An empty or unchanged name saves nothing.
- The name stays pressable while the agent works.
- The saved name appears in every console and window using that agent and account folder, including after a restart.
- These names are [kept on this machine](../01-features/05-settings.md#files).

### Model and effort

- The model drops its brand and leads with its named word, so **gpt-6-sol** reads **sol-6**. Point at it for the full name.
- Press **Model**, or the reported model, to open the agent's own model picker in one press. It lists the versions your account can use and marks the one in use.
- Codex updates the label as soon as its picker confirms a choice. Other agents keep the last reported model until their next status report.
- Press **Effort** beside the model to open the agent's reasoning choices.
- Claude Code and Antigravity open their effort pickers. Codex opens its model picker, where confirming the current model reaches its reasoning levels.
- The agent shows which levels your model supports and which is selected, and handles saving or canceling.
- The button shows the reported level as one letter: **L**, **M**, **H**, **X** for extra high, **Mn** for minimal and **Mx** for max. Point at it for the full word.
- Until the session reports a level, the button reads **Effort**. If it has yielded on a narrow console, the model's picker also offers effort choices.

### The context ring's commands

- Press the context ring for **Compact the conversation** or **Start a new conversation**. The old conversation stays on disk for the agent's own resume.
- For Claude Code and Codex the menu also has **Resume a conversation**, which opens the agent's own list.
- Under a rule it has **Ask a side question**, the same as [the Side question button](#the-conversation-as-a-chat).
- These actions work before the agent reports its context usage.
- Model, Effort and these commands wait for the agent to finish and its prompt to be empty. While it works they stay grayed.
- The context ring stays pressable for **Ask a side question**, refused only while the agent asks you something or a message has not gone in.
- Antigravity's own mode hint counts as an empty prompt, even when the console cuts it short.
- Send or clear an unfinished message before choosing a model, effort or conversation command.
- Leaftext types the command, waits to see it in the prompt, then presses Enter separately. Typing, switching consoles or closing one cancels that Enter.
- If the command has not appeared within two seconds, Leaftext leaves it for you to submit. It never clears your message.
- Consoles and their input belong to the installed app; the browser cannot send these commands.

### Choosing the folder an agent works in

- Over a running Claude Code, Codex or Antigravity chat, every folder in the trail at the top is a button. Press one for a menu of the folders in it.
- Right-click the agent's row in **All chats** for the same menu on the folder the agent last said it works in.
- In the menu, press a folder to look inside, the arrow row to go up, or **Choose another folder…** for the system's folder window.
- Only the folder you are looking at is read, and the library pane stays where it was.
- In Claude Code, **Move this conversation here** types Claude's own `/cd` with that folder, and the conversation goes on there.
- The trail and the row change only once Claude reports working in the new folder. If it does not, they keep the old folder and Leaftext tells you.
- Codex refuses to change folder in the session Leaftext starts, and Antigravity keeps a conversation in its own project.
- So for those two, **New conversation in this folder** opens a new console there with the agent's usual settings. The first conversation stays open, untouched.

### What each agent reports

- Starting `codex` in a Leaftext console reports its model, effort, folder and account limits before the first prompt.
- Codex's model and effort changes appear immediately. A fresh conversation starts with zero context; a resumed one shows saved usage when available.
- The plugin hooks remain a fallback. Missing quota windows and dollar cost stay absent.
- Starting `claude` in a Leaftext console relays its model, effort, context capacity, limits and cost to the row.
- Your own custom status line keeps its input and output, and your settings stay unchanged. The relay applies only to that launch.
- An explicit path to either agent's native executable bypasses the console helper. Managed policy can prevent Claude's callback.
- The row shows only reports it actually receives.

### More about consoles

- To watch a note change while the agent works on it, press the chat's row in **All chats** with the note in front.
- The chat then stands in [the chat column](../01-features/02-navigation.md#the-chat-column) beside the note, and a document the agent opens lands beside it.
- Press the close in the chat's top row to put it away; the agent keeps running.
- A console moved into another window keeps its readable prompt and status. Use **Move to a new window** on its row's menu in **All chats**.
- Model and Effort then work on its status row without redrawing the terminal.
- The mouse wheel scrolls the conversation as in the agent's own terminal. A program that asks for the mouse gets one step a notch, so your draft stays.
- Once [connected](#connect-on-windows), the agent is told it runs inside Leaftext.
- `leaftext_open` opens a web address in a new [web tab](../01-features/02-navigation.md#web-tabs) instead of an outside browser. `leaftext_eval` and `leaftext_gesture` then work that page.
- `leaftext_close` closes a tab the way its own close button does, a web page included.

## Ask an agent about a passage

- Highlight words in a note and press **Ask agent** on the bar over them. It lists every console with an agent, named as its row is.
- Press one, and the agent is handed the words as its next prompt, quoted, under the note's path and the line they came from.
- Highlighting alone sends nothing. The passage is the one highlighted when you pressed **Ask agent**, however the selection moves afterward.
- The button appears only while a console holds an agent.
- Leaftext never types into a console at a bare prompt, or one running a command that reads no typing.

## Define a word in a book

- Highlight a word in a book and press **Define** on the bar over it.
- The word, the sentence you met it in, and the words the book's glossary already holds go to a coding agent in a console in the same window.
- The agent writes an entry for the word in the sense this book uses it, and for related words it finds, into the `GLOSSARY.md` beside the book.
- It writes through `leaftext_glossary`. The glossary sheet opens on the new entry, with the related words named at its foot.
- The word is then underlined through every chapter.
- A word the glossary already has opens its entry and asks nobody.
- A glossary with unsaved edits in a tab, or no agent in a console, is said in one line on the bar, and nothing is written.

## Agents in different consoles talk to each other

### The channel

- With agents in several consoles, one agent can hand a finding, a request or a question to another over a channel of their own.
- `leaftext_consoles` lists every console and which ones hold an agent.
- `leaftext_send` hands another agent a message, `leaftext_ask` waits for its answer, `leaftext_reply` answers, and `leaftext_pending` lists the asks waiting.
- Nothing is typed into a console, because that console is where you type. Nothing in its message box is touched.

### How each agent takes a message

- An idle Claude Code takes the message as a turn of its own, through the listener Leaftext hands every Claude Code it starts. This works with any plugin version.
- Codex started in a Leaftext console takes it as a turn on its own app server.
- Any agent busy with a task takes the message on its next step.
- Antigravity with the plugin takes it at once in its own conversation, idle or mid-task, through its own agent connection.
- Antigravity's first ordinary prompt of each conversation asks once to run Leaftext's setup command outside its terminal sandbox, which cannot reach Leaftext.
- Where that is declined, or the plugin is off, a message waits for the end of that agent's next turn.
- A message to a Claude Code whose listener is not running is refused, and the sender is told so.
- Starting Claude Code again in a Leaftext console brings its listener back. A listener stops when its Claude Code ends.

### A message is your order

- Every agent is told that a message from another of your agents is your order. It takes a job, a console name, a role, files to own or a rule you changed at once, without asking you first.
- A Claude Code that Leaftext starts gets this in its system prompt. Claude Code marks each message its listener hands over as not your input, and the system prompt is what outweighs that mark.
- An appended system prompt of your own keeps its words, with this rule added after them.
- A message marked as read from outside your machine, such as a web page or a release note, is passed on as material to weigh, not as an order.
- The message line itself says it is your order, sent by your agent in a named console.

### A long message is read whole

- Claude Code shows only about the first 500 characters of a message its listener hands over.
- A longer message arrives cut at that length. It ends by naming the message's id and `leaftext_pending`, which returns the whole text.
- Messages waiting together are handed to Claude Code one event at a time, each within that length.
- `leaftext_pending` with an id returns any message that reached the asking console, not only an unanswered ask. No other console can read it.
- Leaftext keeps the newest 64 messages each console received, up to 256 KB, while that console's agent is on the channel.
- Codex and Antigravity take a message as a turn of their own, which carries it whole up to about 32,000 characters. A longer one ends the same way, naming `leaftext_pending`.

### Stopped chats

- A chat Leaftext stopped for sitting idle stays in `leaftext_consoles` under its old number, marked stopped.
- A message to it starts that chat again behind whatever you are reading, and reaches it once its agent can take it.
- An Antigravity there needs a first prompt from Leaftext, since it takes a message only through the connection its own turn makes.
- The answer names the number the sender wrote to. Where the chat cannot start, Leaftext tells the sender why.

### An agent on another machine

- An agent on another machine joins the same channel when you reach that machine with `ssh` typed in a Leaftext console.
- Leaftext hands the connection a tunnel back to this channel and a key for that console.
- The agent you start there, with Leaftext's plugin installed on that machine, then asks, sends and answers the agents here as the agent in that console.
- No port is opened to the network. The tunnel travels inside your own SSH connection.
- It is made only for a login, never for `ssh` running a single command.
- Leaftext keeps a record of who joined and which console sent what, never what a message said.

### A planner, a builder, reviewers and a scout

- You can run a whole team this way, with nobody carrying messages between them.
- Ask one agent, the planner, to set it up. It starts the builder, the reviewer, the security checker and the scout with `leaftext_start_agent`, each beside it.
- A builder from one company and a reviewer from another work as well as two of the same. Claude Code, Codex and Antigravity share one channel.
- When a change is ready, the builder asks the reviewer and the security checker at once with `leaftext_send` set to expect a reply, and keeps working.
- Each verdict reaches the builder as a message of its own when that agent answers.
- `leaftext_ask` waits on one answer for up to fifty seconds. A review that takes longer arrives as a message too.
- A scout watching for new tools, releases and security news reads the web in Leaftext's own web tabs, on a [Repeat](#repeat) if you like.
- The scout marks what it passes on as read from outside this machine, so the receiving agent weighs those words rather than obeys them.
- An agent stopped on a question for you keeps any message sent meanwhile, and takes it once you answer. The sender is told it waits on you.
- Everything stays on your machine. The channel is Leaftext's own connection between its consoles, and a private project needs no GitHub or other service.

## An agent starts another and waits on it

- `leaftext_start_agent` opens a console beside the asker's, in the same folder and window, and types the command line it was given, such as `codex` or `claude`.
- It answers once that agent is up and can take a message. For Claude Code, that is once its listener has been heard asking for messages.
- Where the listener never starts, the call says so rather than answering ready.
- An Antigravity started this way opens on a first prompt telling it to take its waiting messages, since it hears the channel only after a turn of its own.
- Its tab is named for its role until it names its job.
- The asker hands it the job with `leaftext_send`. `leaftext_wait` holds until the agent is done or needs somebody, then answers its state and the last lines it wrote.
- A wait answers after 50 seconds unless it asks for longer, saying the agent is still going. The asker calls it again.
- The started agent's console is a tab like any other, so you can watch it work and step in.
- The helper reaches the agent that started it with `leaftext_contact_supervisor`.
- It can send a decision it cannot go on without, structured questions whose answer comes back in a fixed shape, or a progress note that changes the plan.
- Started with a role — worker, scout or adversary — a helper joins the starter's team. It sees and messages only that agent and its other helpers with a role.
- `leaftext_team` lists that team. Started with `visibility` set to `local`, a helper can reach every console.

## An agent drives your other windows

- An agent in a console can see and operate another window on your computer, such as a browser you are signed in to, or any other program.
- `leaftext_look` with nothing named lists the visible windows. With one named, it answers a picture of that window.
- `leaftext_point` moves, clicks, drags or scrolls at a place in that picture.
- `leaftext_type` types text and presses keys such as Enter or `Ctrl+A` (`Cmd+A` on a Mac).
- The first time an agent looks at a window, Leaftext asks you in a system box whether that console's agent may see and operate it.
- Nothing is seen until you press Yes. The agent cannot answer that box, and Leaftext's own windows can never be looked at or pressed in.
- While the session lasts, a notice at the top of that console's window names the window being driven. Its Stop ends the session.
- The session also ends when you close that console or the window it drives. Asking about another window starts a new question.
- Nothing is remembered, so the next agent asks again.
- If you click into another window while the agent works, it stops rather than taking the window back, and asks for a fresh look.
- On a Mac, macOS asks once whether Leaftext may record the screen, which is how it sees. It asks once more for Accessibility, which is how it clicks and types.
- Allow both in **System Settings → Privacy & Security**, then start the agent again. Looking at a window on a Mac needs macOS 14 or later.

## The board

### Opening a board

- **Board**, the first row of the Conversations list, above your wisp, lays your work out beside the list.
- Each lane is a column, each card a row of a Markdown table, and under each card every chat working it.
- Any table with a column of choices is a board, such as tickets by stage or a reading list by status. So is anything [kept as a board in its frontmatter](../01-features/08-relational-tables.md#a-board-that-stays-a-board).
- The row carries the board's card count and stays lit while the board stands.
- The first press, with no board kept, opens **Pick a board** in the place itself, never a file window.
- Pick a board says what a board is in one sentence, then offers **Your boards**, **New board** and **Open a file as a board…**.
- Your boards lists boards Leaftext already holds by name: notes whose frontmatter says `board:` among your open tabs, recent files and the open vault.
- It also lists the `BOARD.md` beside any `PLAN.md` among them, without searching your disk. Somebody with none is told so in one line.
- **New board** asks a name, its lanes (`To do, Doing, Done` to start), and where it goes: the folder New starts in, with **Change…**.
- **Make the board** writes one Markdown file there with the lanes in its frontmatter and one card in the first lane, then opens it.
- A name already taken gets a number after it; nothing you have is written over.
- **Open a file as a board…** opens the file window for a Markdown file, and reads the file before keeping it.
- A file whose table has a column of choices, or a column called Status or Stage, opens as a board.
- Any other file is refused in plain words — it has no table, or nothing to make lanes from — and the board you had stays.
- The board you see is kept across launches. A kept board that has gone or no longer draws is forgotten, and the next press says why.
- The board's name in the header opens the switcher: every board found, the one drawn ticked, then **New board…** and **Open a file as a board…**.

### The header

- The header reads `Board`, the board's own heading as its switcher, how many chats are working, and how many cards there are.
- Cards are counted as tickets where every card links one.
- Only when there are any, it adds how many chats need you, sit idle or stopped on an error, how many cards are bugs, and how many wait on another.
- **All**, **Bugs** and **With a chat** filter the cards. **Rank** and **Activity** order them. **Refresh** reads the board again.
- **New chat** opens the rail's own launcher.
- On the running order, **Add to board** starts Claude in the board's folder with `/ticket ` typed and unsent.
- On any other board it reads **Add a card**, which opens the board's own file, where cards are added, moved and kept with Save.

### Columns and cards

- The columns are the note's `board-columns`, each with its stage mark, name and count.
- Each column is full height, its cards scrolling inside it, forty at a time and then **Show 40 more**. An empty column reads `None`.
- Columns keep their width, and the board scrolls sideways, its edge faded where more stand past it.
- A card is [the note's card](../01-features/08-relational-tables.md#what-a-card-says): its title, a red pill for a bug, its rank, track, chat count and age, and what it waits on.
- A card is edged amber while a chat on it needs you, or while it waits on another card.
- Under it is one line per chat working it, newest first: its dot, agent, title, state and age, the unread mark, and the lines its turns changed.
- A working chat's line carries **Stop**.
- A card in the last column carries **Retire**, which opens a chat with `/done` and the card's file typed and unsent.
- A chat is tied to a card when the hooks recorded its session building or designing the card's file, or when its last prompt names that file.
- Pressing a chat puts the board down and brings the chats back with that one in front. Pressing a card's title opens its file in the documents column.

### Moving cards

- A board whose note says `board-moves` takes no drag. A dragged card goes back and the note's own sentence shows, since the stages are written elsewhere.
- On any other board, dragging a card opens the board's own file, where the move is made.
- The board reads its note when it opens, on **Refresh**, and whenever a chat on it stops working. It never reads on a timer.
- The chats arrive a moment after the cards.
- On any board a note keeps, moving a card to another lane tells every console whose agent read that note through `leaftext_doc` this session.
- That is one intercom message naming the card, the lane it left, the lane it reached and the note. A console that never read the note hears nothing.

## Closing the last window

- Closing Leaftext's last window hides it rather than quitting, so your wisp and every console keep working.
- A Leaftext icon sits in the notification area on Windows and in the menu bar on a Mac. On a Mac, Leaftext also leaves the Dock until its window returns.
- While hidden it takes as little as it can: the page stops drawing, its timers stop, and on Windows the browser engine gives memory back.
- The icon's menu reads Open Leaftext and Quit. On Windows a click on the icon opens it, and so does starting Leaftext again or opening a document with it.
- Quit on the icon, or `Ctrl+Q` on Windows and `Cmd+Q` on a Mac, ends Leaftext and saves the window's size and place.
- Turn off **Keep running when you close the window** on your wisp's sheet, and closing the last window quits again.

## Scheduled

### A scheduled task

- **Scheduled**, the alarm clock under Conversations in the icon rail, opens the page of tasks Leaftext starts an agent for on a clock.
- A task is one prompt for one agent — Claude Code, Codex or Antigravity, on an account the New menu lists — in one folder, on a timetable.
- The timetable is hourly, daily, weekdays, weekly on a day, manual, or once.
- When it is due, Leaftext opens a new console in that folder behind the tab you are reading, starts the agent, types the prompt and presses Enter.
- The form and the task's page show that line under **Leaftext will type exactly this, then press Enter**.
- A task can open with a skill that agent lists for the folder. It is written in the agent's own sign: `$name` for Codex, `/name` for Claude Code and Antigravity.
- The skill is checked again before each run. A skill gone from the folder writes the run failed and types nothing.

### Runs and the task list

- Each run's console is named after its task. Its conversation stands under **Scheduled** in Conversations, unread until you open it.
- Every task in the list carries **Edit**, **Pause** or **Resume**, and **Delete**. Its page also has **Run now**.
- **Delete** asks first and keeps the runs' chats.
- **New task**, a template and **Edit** open the form as a bottom sheet. Close it with **Cancel**, its cross, Escape, a press outside it, or a drag down.
- The **Scheduled** tab has no close. Pressing Conversations, Documents or Outline, another tab, or opening a document brings back the tab you were reading.
- A task's history says when each run fell due and what came of it: ran, skipped and why, or failed and why. Two tasks due in the same minute both run.
- Templates offers Claude's six starting points, each filling the form.

### When tasks run

- Tasks run only while Leaftext is running, open or in the notification area, and the computer is awake.
- While any task is Active, closing the last window keeps Leaftext in the notification area, even with **Keep running when you close the window** off.
- Leaftext looks once a minute.
- After a sleep, or a time it was not running, every missed time is written skipped, and one catch-up run starts for the latest within seven days.
- A run due while the one before it is still working is skipped.

### Agents set up tasks too

- Ask an agent in a console, or your wisp, for something "every weekday at 8am", and it makes the task with `leaftext_schedule`.
- That tool lists, makes, changes, pauses, resumes and runs tasks, but never deletes one. The task shows on the page at once.
- A task made this way starts in the asking agent's folder and agent, unless the request names others.

## An agent going round in circles is told

- When an agent calls the same Leaftext document tool on the same file, and it fails the same way three times running, Leaftext types one message into its console.
- That message is headed `From Leaftext`, names the tool, the file and the kind of failure, and asks the agent to try something else.
- It is said once per run of failures. A success, another file, another tool or another kind of failure starts the count again.
- `leaftext_attempts` lists the agent's last sixteen document calls as Leaftext saw them: the tool, the file, whether it worked, and the kind of failure.
- It keeps none of the document, the answer, or the refusal's words.
- Leaftext sees only its own document tools. The agent's shell commands, other tools, model calls and approval prompts are never counted.
- A call you turned down never reaches Leaftext at all.
- The count lives in the agent's own Leaftext connection, so it is separate for every agent and gone when the agent or its console closes.

## Design on a canvas with comments

- The **New** menu lists, under **Designs**, every canvas in the folder New starts in, newest first. The menu's filter searches them.
- **New slides**, **New design** and **New design system** each write an empty canvas there, named for its kind and numbered past any already there.
- Each opens in a web page tab.
- A canvas is one HTML page holding its boards. Drag or scroll to pan, `Ctrl` and the wheel to zoom, and **F** to fit everything.
- **Play** shows a screen at a phone, tablet, laptop or the window's own width.
- **C** or **Comment** drops a pin on a screen. A thread takes replies, can be resolved, and can be deleted.
- Every comment is kept as one line at the end of the canvas file itself, so the canvas is the whole record.
- A canvas made in another tool that writes the same lines reads the same.
- An agent in a console beside it can read the open comments and write its answer into the thread. Claude Code, Codex and Antigravity each do.
- The canvas redraws with the reply under the comment it answers.

## Hold an agent to your checks

### How it works

- Put a `HARNESS.md` in a project folder, and an agent working there with the [plugin](#install-the-plugin) is held to the checks it names.
- Each time the agent tries to end a turn that changed a file, through a file tool or a shell command, Leaftext runs each check.
- If one fails, the agent is sent back to work with what failed. The turn ends only when every check passes.
- Claude Code, Codex and Antigravity all work this way, through the hooks the plugin brings.
- A folder with no `HARNESS.md`, and none in a folder above it, is left alone.
- A turn that only talks, or whose shell commands changed nothing, is never held, unless the turn before it was sent back.

### The checks table

The checks are one table. Anything written around it is ignored:

```markdown
| Check | Command | Seconds | Skill | Shares |
| --- | --- | --- | --- | --- |
| Tests | cargo test | 600 | sync-tests | target |
| Lint | cargo clippy | 300 | | target |
| Page script | just check-shell | 120 | shell-fragment | |
```

- A check passes when its command ends without an error, inside its seconds.
- The checks run side by side, so a turn waits for the slowest rather than for all of them added up.
- Rows naming the same word under `Shares`, such as two commands building into one folder, run one after another instead. Each such word's checks may take an hour together.
- A pipe inside a command is written `\|`.
- When a check that names a skill fails, the agent is told to read that skill before its next change.
- While Leaftext is open, every document the agent wrote that Leaftext reads also goes through the same check `leaftext_check` runs.

### Trust and the run note

- Nothing in a `HARNESS.md` runs until you trust it. In a console in that folder, type `leaftext --harness trust`.
- It prints every command the file names and asks you to type `yes`. Change the file and it asks again.
- A file trusted by an earlier version of Leaftext is asked about once more.
- An agent cannot trust it for you, because the question is answered only at a console a person is typing in.
- `leaftext --harness check` runs the checks by hand and prints each result and the score.
- Every attempt is kept in a run note, one per agent session, in Leaftext's own data folder rather than your project.
- The note lists each job, each attempt, what every check last printed, the score, and which attempt was best.
- The message that sends the agent back ends with the note's address. `Ctrl`+click it (`Cmd`+click on a Mac) to open it as a tab.

### When the agent goes round in circles

- When the same check fails the same way three attempts running, the agent is told to stop repeating that change, re-read the skill, and plan a different one.
- The harness also reads the run records it kept for earlier sessions.
- A check that failed the same way in three sessions is written at the top of the run note as a suggestion. So is a skill you stopped or turned back three times.
- Nothing in a skill or a check is changed.
- With a `pointers: on` line in `HARNESS.md`, a prompt naming a file brings the agent links to run notes. They come from up to three earlier sessions that worked on that file.
- When three attempts in a row score below the best so far, the agent is told which attempt was best, its score and the files it changed.
- When a turn after a send-back writes no file and every check fails just as before, the job ends there. The console says the agent is not changing what fails.
- After eight attempts on one job, the turn ends however it scored. The console names the best score and where the note is.
- Leaftext never commits, never puts files back, and never changes how the agent itself works.

### A company gateway

- For a company gateway, follow the agent's own instructions: [Claude Code's gateway setup](https://code.claude.com/docs/en/llm-gateway) or [Codex's model provider configuration](https://developers.openai.com/codex/config-reference).
- The gateway must support the request format and authentication the chosen agent sends. Connecting Leaftext as a tool server is a separate step.

## Install the plugin

- The plugin connects your agent to Leaftext. It teaches it to read, edit, check, tick and save the open document, and to write the alerts, diagrams, math and tables Leaftext draws.
- It also teaches the agent to browse in Leaftext's tabs, search your vault, name its console, talk to your other agents, and start helpers beside it.
- It adds one skill and the `leaftext --mcp` tool server, and changes nothing else about your agent.
- When Claude Code or Codex starts with an older Leaftext plugin, Leaftext starts that agent's own plugin update. The new instructions load after a restart.
- For routine project documentation, the agent edits files without opening them in your window. Ask it to work on an open document to use Leaftext's tools.
- On Windows, the installer puts the word `leaftext` on your command path.
- On a Mac, opening Leaftext puts it in `~/.local/bin`. An agent started before that says its Leaftext server failed, and a restart finds it.
- A `leaftext` command of your own already in that folder is left as it is.
- Update an existing Antigravity clone with `git -C ~/.gemini/config/plugins/leaftext pull`, then run `agy mcp add leaftext -- leaftext --mcp`.
- Installing the plugin and connecting its tools are separate steps, so the skill can be listed while the tools are not yet there.
- After any change to the agent's tool servers, restart it and check that a tool such as `leaftext_doc` appears.
- If the skill is there and the tools are not, the server list says why: `claude mcp list`, `codex mcp list` or `agy mcp list`.
- Claude Code started in a Leaftext console has Leaftext's tools in any folder, even before the plugin is installed.
- That holds where no settings switch the plugin on and the folder lists no `leaftext` server of its own. The server lasts for that one launch.
- Once the plugin is on, the plugin supplies the tools instead.

## Connect on Windows

Run these once in a Leaftext console, and every later Claude Code or Codex session, in any folder, has Leaftext's tools and is told it runs inside Leaftext:

```
claude mcp add --scope user leaftext -- "%LOCALAPPDATA%\Programs\leaftext\bin\leaftext.exe" --mcp
codex mcp add leaftext -- "%LOCALAPPDATA%\Programs\leaftext\bin\leaftext.exe" --mcp
```

For another agent, replace `YOUR_NAME` with your Windows account folder name and add this server to its MCP settings:

```json
{
  "mcpServers": {
    "leaftext": {
      "command": "C:\\Users\\YOUR_NAME\\AppData\\Local\\Programs\\leaftext\\bin\\leaftext.exe",
      "args": ["--mcp"]
    }
  }
}
```

## Connect on a Mac

Run these once in a Leaftext console, and every later Claude Code or Codex session, in any folder, has Leaftext's tools:

```
claude mcp add --scope user leaftext -- /Applications/leaftext.app/Contents/MacOS/leaftext --mcp
codex mcp add leaftext -- /Applications/leaftext.app/Contents/MacOS/leaftext --mcp
```

For another agent, add this server to its MCP settings:

```json
{
  "mcpServers": {
    "leaftext": {
      "command": "/Applications/leaftext.app/Contents/MacOS/leaftext",
      "args": ["--mcp"]
    }
  }
}
```

- Your agent's settings decide which calls need your approval. Leaftext offers every tool and shows no approval box of its own.
- `leaftext_eval` runs any JavaScript inside Leaftext's page, so give an agent access only when you trust it with the open document and app.

## Work on a document

- Ask the agent to use `leaftext_doc` to read a file. It opens the file in the window and answers its text, task list and fingerprint.
- To edit, the agent sends that fingerprint with `leaftext_edit`, waits for the page with `leaftext_idle`, then writes the file with `leaftext_save`.
- To tick a checkbox, it uses `leaftext_toggle_task` with the task's place in the list. That writes the file immediately.
- Before it says it is done, `leaftext_check` asks what is wrong: a diagram that will not draw, a relation naming a missing row, a data file that will not read.
- It also finds a link to a missing file and a wiki link to a note that does not exist.
- `leaftext_check` changes nothing, and answers the same fingerprint as `leaftext_doc`, so a fix can be written against the same reading.
- `leaftext_diagrams` lists a document's diagrams: each one's place, line and kind.
- `leaftext_diagram` on one says whether it draws. Given a path, it writes the drawing there as a PNG the agent can open.
- An agent with no tools set up can run `leaftext --diagrams notes.md` at its prompt. It [checks every diagram in the file](../01-features/01-rendering.md#checking-a-files-diagrams) in a hidden window.
- That prints a line per diagram and writes each drawing as a picture, with no Leaftext window needed.

### Writing a diagram from the prompt

You, or the agent, can write a diagram into a Markdown file from the prompt and have it kept only if Leaftext draws it. Pipe the diagram in without its fence and name one place:

```text
type flow.mmd | leaftext --chart notes.md --append
type flow.mmd | leaftext --chart notes.md --at 12
type flow.mmd | leaftext --chart notes.md --replace 40
```

- `--append` puts it at the end of the file.
- `--at` puts it before the line you name. That line must be blank, the first line of a block, or one past the last line, so nothing is split.
- Any other line is refused, with the line that would do.
- `--replace` swaps the diagram whose fence opens on the line you name.
- A diagram that draws is saved and its line printed, such as `notes.md:12  flowchart  kept`.
- One that does not draw is refused with the renderer's own words, and the file is left as it was.
- A call missing its place or diagram exits with 2, and a refused diagram with 1, so a script can tell them apart.
- The tools reach the Leaftext copy running under your account. If it is closed, the agent is told plainly that Leaftext is not running.
