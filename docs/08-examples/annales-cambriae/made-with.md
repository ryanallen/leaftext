# Made with

What every Arthurian book says about how it was made: the made-with line, the how line under it, and the notes they point at. These tables hold what every book on the shelf was made by, not one book's: each book carries only the phrases it used, named by its row in the [Books table](#books), and the whole story in one book carries all of them, once, in its front note, the books it is built from carrying none inside it. Ryan Allen's bio is one row, so if a site moves, only the Notes row changes: a glossary carries it as the footnote `[^ryan-allen]` on his name, and a translation or source text links his name to it at the top of its how page. It lives in these tables and nowhere else: every translation and source text carries a copy in its front note, straight after the note's first paragraph, with no footnote, so the story's own endnotes number from 1, its byline naming Ryan Allen and its license alone under `## License` at the back, on the owner's word of 8 October 2026, 11:53am, and every glossary in its opening paragraph, between `<!-- made-with -->` and `<!-- /made-with -->`, and `/test` counts the new tokens and restamps every copy from these rows each time it runs. Change the words here, never in a book.

The number in the last column is the total of the token ledger, one row for each turn of work with the book it went to and its count. `node arthurian/tools/arthurian-tokens.mjs` prints each book's total from it, and `--write` writes each book's into its [Books](#books) row; a book's made-with line says its own count where the line says `{tokens}`.

| id | Line | New tokens |
| --- | --- | --- |
| made-with | Translated with machine assistance by Ryan Allen[^ryan-allen] for [Leaftext](https://leaftext.com), {tokens}; a working translation, not a scholarly edition. | 32,621,758 |
| made-how | How it was made: built by Ryan Allen[^ryan-allen], who designed the system that made it, all checks passed, readable first, plain speech, shaped for English, every link said, nothing said twice, the right word each time, no word worn out, modern idiom, US English, localized from US, English word order, natural tenses, contractions, neutral tone, gender neutral, no false echoes, prose and verse read aloud; source lines and stanzas kept, scenes read for movement, checked against the scan, sources named, honest where unsure, no borrowed wording, source over Malory, translated by manifest, every choice logged, changes carried everywhere, story headings, matching outlines, laid out for screens, pages linked to scans, endnotes, Malory cross-referenced, additions marked, sourced glossary, modern names, places located from sources, no guessed identities, no common words glossed, free with credit. | |

## Notes

The notes the lines point at, one row per footnote, keyed by its id: a glossary carries each one its lines use as that footnote, between the same markers, and a translation or source text opens its how page on the ryan-allen row, so a reader opens it from the name. `arthurian-made-with.mjs` refuses a line naming Ryan Allen with no `[^ryan-allen]`, a line linking to his sites, and a table with no ryan-allen row.

| id | Note |
| --- | --- |
| ryan-allen | **Ryan Allen** designs and builds software. Good work disappears into what it's for. [ryanallen.com](https://ryanallen.com) · [GitHub](https://github.com/ryanallen) · [LinkedIn](https://www.linkedin.com/in/ryanallencom) · [Leaftext](https://leaftext.com) |

## Why

Why Ryan Allen made these books, in Ryan's own voice, on the owner's word of 5 October 2026, 5:05pm that the preface planned in a-preface-on-why-england-made-arthur sits with the bio and goes in every book. One row per paragraph, in order. Every translation names these rows rather than carrying their words: between `<!-- why -->` and `<!-- /why -->`, under its own `## Why this book` heading after `## About this translation` and before the story (the owner's word of 6 October 2026, 3:08pm), one link to each row, in order, each alone on its line, which Leaftext, every export made from the page and leaftext.com draw as the row's words, and redraw when this table is saved (the owner's words of 8 October 2026, 10:40am to 10:47am, built on Leaftext v4.8.6). `arthurian-made-with.mjs` writes those links once, publishes this file beside each book so the site can draw them, and refuses typed words between the markers, a row missing or out of order, and a glossary or source text that carries them. Change the words here, never in a book. The essay is the point, so a reader reads its words wherever the book is drawn, never a link standing in for them: the owner's word of 5 October 2026, 5:21pm; only a reader of the raw file sees the four links. The whole story in one book says it once, at its beginning, and no passage taken into it from another book brings that book's copy along: the owner's word of 5 October 2026, 7:31pm.

| id | Paragraph |
| --- | --- |
| why-1 | Before one god wrote the laws, many gods were how we tried to control the chaos of reality. As humans we personify what happens to us: the storm rages because it's angry, and a bribe might cool it down. Villages had their own gods, and when neighbors fought, the winner's gods rose while the loser's gods fell. A defeated kingdom, the people of Judah after Babylon burned Jerusalem, decided their god hadn't lost. It was punishing them. Defeat made that god stronger and portable. A contract strangers could carry anywhere, not tied to nature. |
| why-2 | The Britons wrote Arthur into the contract of Yahweh, that old storm god, and Arthurian legend is how you watch it happen. In the old Welsh stories, Arthur fights giants, hunts a magic boar and kills a witch. Merlin is a wild prophet living in the woods, about as close to a druid as the sources get. A century later, Christian writers rework Arthur into something like fanfic for their faith. Merlin becomes a devil's son baptized for their god, and the knights chase a cup from their prophet's last supper. Get ready for a lot of Jesus talk. |
| why-3 | The contract also licenses conquest, and anyone is fair game. Take from everyone, and have a man with a title pour water on you. Arthur's legend runs on it. He is conceived in rape, arranged by their god's own prophet, who disguises Uther as a woman's husband so he can have sex with her all night. Then their remade god crowns the child with a sword through an anvil. It could have chosen a book or a plow. |
| why-4 | I'm translating these stories to witness them building this new contract from the old one. It grew out of the church into law and money because in God we trust. We can rely on strangers because a court or a bank stands behind them, so we stopped needing the people next door. That's why so many of us live alone in buildings full of neighbors we've never met, and stories like these are how we got here. |

## Phrases

What each phrase of the how line means to a reader, on the owner's word of 4 October 2026, 4:26pm that no phrase leaves a reader guessing. In a translation or source text every phrase links to its section of `{book}-how-it-was-made.md`, published beside the book, which opens on its row and, for a phrase the How table shows at work, then links to the file. In a glossary a phrase the line links to nothing carries its row as a footnote, `[^how-<id>]`, stamped under the lines with Ryan Allen's, and a phrase shown at work links to its section of the how page. "—" only where the phrase's own words already carry a footnote. `arthurian-made-how.mjs` refuses a phrase the line says with no row here, and a row for a phrase it no longer says; `arthurian-made-with.mjs` writes the page beside every book it stamps and refuses one missing, out of date or linking to nothing.

| Phrase | id | Note |
| --- | --- | --- |
| built by Ryan Allen[^ryan-allen], who designed the system that made it | designed-the-system | The tools that made this book, its checks and the rules they hold were designed as one system, and every line in it came out of that system. When a passage reads wrong, the fix goes into the system and the book is made again, never written in by hand, so it reaches every book on the shelf. |
| all checks passed | all-checks-passed | Every range was run through the book's own check tool and the shelf's checks, and nothing was ticked done until they passed: a missing page, a broken link, an old word, a word repeated too soon, a wrong mark and a change nobody logged are all refused. |
| readable first | readable-first | Each passage is told the way a good English writer would tell it today, then checked against the source so every event, person and act is there and nothing is invented. |
| plain speech | plain-speech | No Bible cadence and no stiff old-translation voice: no chains of "and… and… and", no solemn word order, no word nobody says now. |
| shaped for English | shaped-for-english | Each sentence is written as English, not in the source's grammar: a verb rather than a noun made of one, never a clause hanging off a clause, and what someone must do before where or why, with nothing lost. Every sentence that says a common verb twice was read and either rewritten or kept with the reason. |
| every link said | every-link-said | Where the source joins a cause and its effect with a bare "and", the English says how they connect, with "to", "by", "so", "until" or "because". |
| nothing said twice | nothing-said-twice | What the source says twice, a doubled verb or a speech the narration has just told, is said once, unless a speaker repeats it on purpose, and the book's account of its text is given once, its edition and scans cited in full only under Sources. |
| the right word each time | the-right-word-each-time | A source word with several senses takes the English its moment needs, never one word everywhere and never the vaguest. |
| no word worn out | no-word-worn-out | No word comes back within forty words of itself, names and the commonest grammar words aside; the second use takes another word or goes. |
| modern idiom | modern-idiom | Old English turns give way to the ones people use now, in how people talk to and about each other as much as in rare words: "pregnant", "said goodbye", "my mom". Every word judged old is kept in the shelf's list, and the check refuses each one. |
| US English | us-english | The reviewed US master uses Merriam-Webster spelling and usage, the article a US reader says, as "an herb", *The Chicago Manual of Style*, and lengths and distances in feet and miles. A later UK edition is made from that master. |
| localized from US | localized-from-us | After the complete US book has been read and checked, regional editions are built from that text. The UK edition is first. A shared list and a book's locale record give each changed spelling, word, measure and use, so later editions can start from those choices. |
| English word order | english-word-order | The shelf's list of source word orders that must never show through in the English, as "taken from us everyone" for "taken everyone from us". The check refuses each shape on every page of every book, and a shape found later is added and swept over every page already written. |
| natural tenses | natural-tenses | The story is told in the simple past wherever the order of events is plain, as English tells it, not in the source's stacked past tenses. |
| contractions | contractions | The shelf's list of every long form English shortens when it's said aloud, and when: "who is" to "who's", "do not" to "don't", or "never" with the reason. The check refuses a listed form left long in the text, the headings and the notes. |
| neutral tone | neutral-tone | No archaism and no color the source doesn't give, but a hard word stays hard. |
| gender neutral | gender-neutral | Where the source means anyone, the English says "they", "people" or "anyone", never "he" and never a pair of pronouns; a figure the source names keeps the pronoun the source gives. |
| no false echoes | no-false-echoes | No English turn that calls up a better-known story the source doesn't mean: Christ leads Adam and Eve out of hell, never "casts them out", which calls up Eden. An echo the source means stays. |
| prose and verse read aloud; source lines and stanzas kept | read-aloud | Every sentence or line was read aloud and its slack cut with no fact dropped; prose stays in paragraphs, and verse keeps its lines and stanzas, and its beat and rhyme wherever they survive. |
| scenes read for movement | scenes-read-for-movement | Each whole scene was read for what each speaker wants and where it turns, and the whole book in order, so the dialogue and paragraph breaks carry it; nothing the source doesn't give was added. |
| checked against the scan | checked-against-the-scan | The source text this translation was made from, established page by page against scans of the printed edition: misread letters restored, damaged words settled and the printed corrections applied, each with a note. Where the machine-read text and the page disagree, the scan wins. |
| sources named | sources-named | Every reading says whose it is: the scholars who edited the text by name, the printing by its year, the handwritten copy by its own name, and this translation's own work as "this translation", never "we". |
| honest where unsure | honest-where-unsure | Where the dictionaries leave a passage open, it's translated as the scholars who edited the text read it, and the doubt is given in an endnote, never smoothed over. |
| no borrowed wording | no-borrowed-wording | Nothing was translated from Malory's English or any modern translation; they were used only to find where a passage sits in the legend. |
| source over Malory | source-over-malory | Where Malory tells a passage differently, the source is the story and his version goes in a note; where sources are joined into one book, the one written first leads. |
| translated by manifest | translated-by-manifest | The manifest's phrases: every recurring phrase of the source with the one English chosen for it, any other English allowed and when, the page it was first decided on, and why. Phrases are translated first, longest first, so the same words read the same way everywhere. |
| every choice logged | every-choice-logged | The manifest's words: every recurring source word with its English, the other English each moment allows, the page it was first decided on, the reason, the dictionary it rests on, and every page logged as an exception. |
| changes carried everywhere | changes-carried-everywhere | The change log: every change made to a page after it was translated, with its time, its kind, its pages, the English before and after, and why. A changed choice is made in the manifest first and carried to every page it reaches, and the check refuses a page that changed with no change logged. |
| story headings | story-headings | Every heading says what happens in its section, in a short plain sentence, so the headings alone tell the story, without giving away how a fight, a trial, a prophecy or a secret turns out. |
| matching outlines | matching-outlines | The source text carries the same headings as the translation, in English, at the same places, so the two outlines match one for one and a heading in either opens the same passage. |
| laid out for screens | laid-out-for-screens | Laid out as a modern book read on a screen: a new speaker starts a new paragraph, no paragraph runs past 130 words, and the punctuation is a US book's. |
| pages linked to scans | pages-linked-to-scans | Every page marker in the translation links to the same page of the source text, and each page there opens that page of the scan, kept two ways: a link to where it was found online, and a copy saved beside the book in case that site goes down. Any paragraph can be checked against the page it came from. |
| endnotes | endnotes | The endnotes at the end of the book: what a reader would ask about a custom, a reference or a word, where Malory keeps or changes a passage, and where the source text is uncertain. |
| Malory cross-referenced | malory-cross-referenced | Where Malory's *Le Morte d'Arthur* tells the same passage, an endnote names his book and chapters; where it doesn't, nothing is said. |
| additions marked | additions-marked | A note or glossary entry this translation adds, rather than one the printed edition gives, ends on an asterisk that links to the line saying so, so a reader always knows whose explanation it is. |
| sourced glossary | sourced-glossary | The glossary of the people, places and words the book uses: each entry comes from the printed edition's own index or word list, or is marked as added, with the page it was found on, and its terms are underlined in the text. Every person, place and people the book names has an entry, linked to its Wikipedia article where there is one, except the names of a family tree, which one endnote explains. |
| modern names | modern-names | Each person and place goes by the name a modern English reader knows, spelled as its Wikipedia article spells it: every name the book writes was looked up there, and the check refuses one never looked up or spelled otherwise, in the story and the glossary alike, with the source's own spellings listed under the glossary heading. |
| places located from sources | places-located-from-sources | Each place in the glossary says whether it's real, legendary or uncertain, and where it is, from a geographic source, or why no identification is secure. |
| no guessed identities | no-guessed-identities | When a figure might be a better-known person from another book, the glossary says so only where the sources do; it never guesses. |
| no common words glossed | no-common-words-glossed | No ordinary English word is a glossary entry, since an entry is underlined on every page of every book that shares the glossary. |
| free with credit | free-with-credit | Anyone may use this book freely, crediting Ryan Allen, under the CC BY 4.0 license this book gives. |

## Books

Which phrases each book's how line says, on the owner's word of 5 October 2026, 7:31pm that this file holds every book's and each book takes what it used. One row per book, keyed by the folder it is published in (its working copies stamped under the same name), naming the ids of the Phrases rows it used; a phrase the book never needed — Malory where he never told the story, verse lines in a prose book, the UK edition before it is made — is left off, so the line never claims a rule the book didn't meet. The whole story in one book is `all`: it carries every phrase, the made-with line, the notes and the why once, at its beginning, and the passages it takes from each book come without that book's block. A book's row is written when its first range is stamped and read again when it closes, by `/translate` step 11; a new phrase goes on the row of the book that taught it, in the same pass. `arthurian-made-with.mjs` stamps each book from its row and writes its how page with only those sections, and refuses a stamped book with no row, a row naming an id the Phrases table lacks, and a book that says how it was made more than once.

New tokens is each book's own count, on the owner's word of 5 October 2026, 8:31pm: the ledger's rows under the book's ticket, which `node arthurian/tools/arthurian-tokens.mjs --write` writes here, and the stamp says in the book's made-with line where the line says `{tokens}`, as "more than 2 million new tokens so far on this book". Shelf-wide work, the tools and checks every book shares, is in no single book's count; the whole story's row counts everything, every book's and the shared, and says "across the Arthurian books". `check-arthurian.mjs` refuses a row whose ticket is in neither `tickets/` nor `done/`.

| book | Ticket | New tokens | Used |
| --- | --- | --- | --- |
| merlin | robert-de-borons-merlin-in-english | 10,830,583 | designed-the-system, all-checks-passed, readable-first, plain-speech, shaped-for-english, every-link-said, nothing-said-twice, the-right-word-each-time, no-word-worn-out, modern-idiom, us-english, english-word-order, natural-tenses, contractions, neutral-tone, gender-neutral, no-false-echoes, read-aloud, scenes-read-for-movement, checked-against-the-scan, sources-named, honest-where-unsure, no-borrowed-wording, source-over-malory, translated-by-manifest, every-choice-logged, changes-carried-everywhere, story-headings, matching-outlines, laid-out-for-screens, pages-linked-to-scans, endnotes, malory-cross-referenced, additions-marked, sourced-glossary, modern-names, places-located-from-sources, no-guessed-identities, no-common-words-glossed, free-with-credit |
| historia-brittonum | historia-brittonum-and-the-welsh-annals-in-english | 6,375,906 | designed-the-system, all-checks-passed, readable-first, plain-speech, shaped-for-english, every-link-said, nothing-said-twice, the-right-word-each-time, no-word-worn-out, modern-idiom, us-english, english-word-order, natural-tenses, contractions, neutral-tone, gender-neutral, no-false-echoes, read-aloud, scenes-read-for-movement, checked-against-the-scan, sources-named, honest-where-unsure, no-borrowed-wording, translated-by-manifest, every-choice-logged, changes-carried-everywhere, story-headings, matching-outlines, laid-out-for-screens, pages-linked-to-scans, endnotes, additions-marked, sourced-glossary, modern-names, places-located-from-sources, no-guessed-identities, no-common-words-glossed, free-with-credit |
| annales-cambriae | historia-brittonum-and-the-welsh-annals-in-english | 6,375,906 | designed-the-system, all-checks-passed, readable-first, plain-speech, shaped-for-english, every-link-said, nothing-said-twice, the-right-word-each-time, no-word-worn-out, modern-idiom, us-english, english-word-order, natural-tenses, contractions, neutral-tone, gender-neutral, no-false-echoes, read-aloud, scenes-read-for-movement, checked-against-the-scan, sources-named, honest-where-unsure, no-borrowed-wording, source-over-malory, translated-by-manifest, every-choice-logged, changes-carried-everywhere, story-headings, matching-outlines, laid-out-for-screens, pages-linked-to-scans, endnotes, malory-cross-referenced, additions-marked, sourced-glossary, modern-names, places-located-from-sources, no-guessed-identities, no-common-words-glossed, free-with-credit |
| the-whole-arthurian-story | the-whole-arthurian-story-in-one-book | 32,621,758 | all |

## How it was made

The second line every book carries, under the first, says how the book was made: every rule the track's skills and `AGENTS.md` hold, in a few plain words, and in each book only the phrases its Books row names; the made-how row is the whole line, what the whole story carries. Each rule has one row here, saying what it means to a reader, or "—" for a step a reader never meets; under "Held by", for every rule a reader meets, the checks that hold it, then `; read:` and what only reading holds and why, or `read:` and why alone, so `/regen` step 5 reads every scene against `arthurian-made-how.mjs --read`'s list; and where a reader sees it at work beside the published book, `{book}` standing for the book's folder and `{source}` for its established source text, so the line links each phrase there; the shelf's lists are published beside every book. The line is the second column in this order, each said once, so the order of the rows is the order of the line: a phrase's rows sit together, and the phrases run from the general to the specific in these groups — who made it (built by Ryan Allen, who read and edited every line, all checks passed); readable first, and the English it is told in; faithfulness to the source; how the translation is decided and logged; the book's parts, from headings to endnotes; the glossary; and last the rights. A new row goes beside its phrase's other rows, and a new phrase into its group, from the more general to the more specific; `arthurian-made-how.mjs` writes it into the made-how row with `--write`, and `check-arthurian.mjs` refuses a rule a skill holds with no row here, a row whose rule a skill no longer holds, a check named here that doesn't exist, a rule a reader meets held by neither a check nor a `read:` reason, a `read:` with no reason, and a line that differs from its rows; `arthurian-made-with.mjs` refuses a published book whose line links to a file not published beside it. A new rule is a new row, in the same pass that writes it into its skill.

| Rule | Said as | Held by | Shown in |
| --- | --- | --- | --- |
| review: Sort each note | built by Ryan Allen[^ryan-allen], who designed the system that made it | read: which kind a note is turns on what the owner meant by it, which nothing on the page shows | — |
| review: Turn a rule into a rule | built by Ryan Allen[^ryan-allen], who designed the system that made it | writing/arthurian/tools/arthurian-made-how.mjs#howProblems; read: whether a note would come up again on another page is a judgment of the note, not a shape in the text | — |
| review: The owner's reading is the authority on how the English reads | built by Ryan Allen[^ryan-allen], who designed the system that made it | read: it settles whose word wins when a note arrives, a choice made in the reply with nothing in the files to match | — |
| ticket: The owner's box is the last box and the only one the owner ticks | built by Ryan Allen[^ryan-allen], who designed the system that made it | writing/arthurian/tools/check-arthurian.mjs#ownerBoxProblems; read: that its box is a thing to open, never a decision, is the box's wording, judged by reading it | — |
| translate: Check the range and tick the box | all checks passed | writing/arthurian/tools/workshop/check.py#main, writing/arthurian/tools/workshop/check.py#credit_problems, writing/arthurian/tools/workshop/check.py#length_problems; read: a sentence missing or added inside a page of usual length is found only by matching sense to sense beside the source | — |
| glossary: Check the range and both glossaries | all checks passed | writing/arthurian/tools/workshop/check.py#glossary_use_problems, writing/arthurian/tools/workshop/check.py#provenance_problems, writing/arthurian/tools/workshop/check.py#place_problems, writing/arthurian/tools/workshop/check.py#name_entry_problems; read: which terms a reader needs explained is a judgment of what the reader knows at that page | — |
| review: A fault in a tool or a check | all checks passed | read: whether a fault is the tool's or the book's is decided when it is found, and the fix's test is its own proof | — |
| review: Check and log | all checks passed | writing/arthurian/tools/workshop/check.py#main; read: that each note's box and record step say what changed and every page it reached is the record's prose, read against the note | — |
| ticket: Every phase has a check box | all checks passed | writing/arthurian/tools/check-arthurian.mjs#phaseCheckProblems; read: whether the check named proves the phase is a judgment of what the phase built | — |
| dev: Tick a box the moment its work and its check are both in | all checks passed | read: when a box was ticked against when its work landed is the order of a session, and the files keep only where it ended | — |
| test: Run the checks | all checks passed | writing/arthurian/tools/check-arthurian.mjs | — |
| test: Fix and run again | all checks passed | writing/arthurian/tools/check-arthurian.mjs, writing/arthurian/tools/workshop/check.py#main; read: that each run and fix is a numbered step with its time is the ticket's record, read against the session | — |
| regen: The tools | all checks passed | writing/arthurian/tools/workshop/check.py#main, writing/arthurian/tools/workshop/check.py#self_test, writing/arthurian/tools/arthurian-made-how.mjs#howProblems | — |
| translate: Readable first, then faithful | readable first | writing/arthurian/tools/workshop/check.py#repeated_verb_problems; read: whether a sentence reads once with the source closed, and whether every event and person is there, are judgments of meaning | — |
| translate: Plain speech, never scripture | plain speech | writing/arthurian/tools/workshop/check.py#and_opener_problems, writing/arthurian/tools/workshop/check.py#old_turn_problems, writing/arthurian/tools/workshop/check.py#pronoun_read_problems, writing/arthurian/tools/workshop/check.py#and_chain_problems, writing/arthurian/tools/workshop/check.py#mine_yours_problems; read: a solemn cadence in other shapes, the narrator's turn to the present between strands, and near-alike names told apart are heard in the sentence or known from the scene | — |
| translate: English shape | shaped for English | writing/arthurian/tools/workshop/check.py#repeated_verb_problems, writing/arthurian/tools/workshop/check.py#pronoun_read_problems, writing/arthurian/tools/workshop/check.py#stacked_clause_problems; read: a noun made of a verb, effort after goal and the obligation said first take every source's own shape, heard by a reader who knows it | — |
| review: A sentence that reads wrong | shaped for English | read: the owner's note names the sentence, and it is held to step 8 by reading it | — |
| translate-old-french: Read the grammar | shaped for English | read: the grammar is read in the source by someone who knows the language; what the English makes of it is held by "English shape"'s checks | — |
| translate-latin: Read the grammar | shaped for English | read: the grammar is read in the source by someone who knows the language; what the English makes of it is held by "English shape"'s checks | — |
| translate-middle-english: Read the grammar | shaped for English | read: the grammar is read in the source by someone who knows the language; what the English makes of it is held by "English shape"'s checks | — |
| translate-middle-welsh: Read the grammar | shaped for English | read: the grammar is read in the source by someone who knows the language; what the English makes of it is held by "English shape"'s checks | — |
| translate-middle-high-german: Read the grammar | shaped for English | read: the grammar is read in the source by someone who knows the language; what the English makes of it is held by "English shape"'s checks | — |
| translate-old-portuguese-and-spanish: Read the grammar | shaped for English | read: the grammar is read in the source by someone who knows the language; what the English makes of it is held by "English shape"'s checks | — |
| translate: Say how acts connect | every link said | writing/arthurian/tools/workshop/check.py#unlinked_problems; read: whether two acts joined by "and" are a cause and its effect is what the story means, beyond the one shape the check names | — |
| translate: Say it once | nothing said twice | writing/arthurian/tools/workshop/check.py#echo_problems; read: narration that tells in other words what the speech then says | — |
| translate: Each fact about the text is said once | nothing said twice | writing/arthurian/tools/workshop/check.py#source_block_problems; read: a fact the note says twice in the owner's own words is heard only by reading the note | — |
| translate: One French word, the English the moment needs | the right word each time | writing/arthurian/tools/workshop/check.py#one_english_problems; read: which sense a moment asks for is a judgment of the scene | — |
| translate: A word is looked up on disk first | the right word each time | writing/arthurian/tools/workshop/shelf.py#sources_problems; read: that a reading rests on the entry it cites is judged by opening the entry | — |
| translate-old-french: Read the words | the right word each time | writing/arthurian/tools/workshop/shelf.py#sources_problems; read: that a reading rests on the entry it cites, and a word read in its own century's sense, is judged by opening the entry | — |
| translate-latin: Read the words | the right word each time | writing/arthurian/tools/workshop/shelf.py#sources_problems; read: that a reading rests on the entry it cites, and a word read in its own century's sense, is judged by opening the entry | — |
| translate-middle-english: Read the words | the right word each time | writing/arthurian/tools/workshop/shelf.py#sources_problems; read: that a reading rests on the entry it cites, and a word read in its own century's sense, is judged by opening the entry | — |
| translate-middle-welsh: Read the words | the right word each time | writing/arthurian/tools/workshop/shelf.py#sources_problems; read: that a reading rests on the entry it cites, and a word read in its own century's sense, is judged by opening the entry | — |
| translate-middle-high-german: Read the words | the right word each time | writing/arthurian/tools/workshop/shelf.py#sources_problems; read: that a reading rests on the entry it cites, and a word read in its own century's sense, is judged by opening the entry | — |
| translate-old-portuguese-and-spanish: Read the words | the right word each time | writing/arthurian/tools/workshop/shelf.py#sources_problems; read: that a reading rests on the entry it cites, and a word read in its own century's sense, is judged by opening the entry | — |
| translate: No word twice in quick succession | no word worn out | writing/arthurian/tools/workshop/check.py#repeat_problems; read: a named thing renamed a line later is two different words, so only a reader knowing they name one thing finds it | — |
| translate: Today's idiom | modern idiom | writing/arthurian/tools/workshop/check.py#old_turn_problems, writing/arthurian/tools/workshop/check.py#before_problems, writing/arthurian/tools/workshop/check.py#unjudged_problems; read: an old turn made of common words is on no list until a reader hears it | — |
| translate: A death is said as a death | modern idiom | writing/arthurian/old-words.tsv, writing/arthurian/tools/workshop/check.py#old_turn_problems, writing/arthurian/tools/workshop/check.py#heading_style_problems; read: a sleep or a rest that means a death is said in the same words as a real one, and an age in "his seventeenth year" in the same words as a reign's, so only the sentence tells them apart | — |
| translate: Hold the range to the house rules | US English | writing/arthurian/tools/workshop/check.py#main | — |
| translate: Plain modern US English for the master, always US spelling | US English | writing/arthurian/tools/check-arthurian.mjs#usSpelling, writing/arthurian/tools/workshop/check.py#article_problems; read: Merriam-Webster's usage and *Chicago*'s style beyond spelling and articles are applied by reading | — |
| translate: Measures in feet and miles in the US master | US English | writing/arthurian/old-words.tsv, writing/arthurian/tools/workshop/check.py#old_turn_problems, writing/arthurian/tools/workshop/check.py#measure_problems; read: rounding as loosely as the source says it is judged against the source's wording | — |
| translate: Years marked CE or BCE | US English | read: whether a number is a year, and whether it is the project's own or a citation's publishing year, is judged from its sentence | — |
| ticket: US spelling | US English | writing/arthurian/tools/check-arthurian.mjs#ticketSpellingProblems | — |
| localize: Finish the US master | localized from US | writing/arthurian/tools/check-arthurian.mjs, writing/arthurian/tools/check-arthurian.mjs#editionTooSoonProblems | — |
| localize: Read the manifests | localized from US | writing/arthurian/locales/en-GB.tsv, writing/arthurian/tools/arthurian-localize.mjs; read: a new recurring difference is found by reading the edition before it can be a row | — |
| localize: Make a candidate from the US text | localized from US | writing/arthurian/tools/arthurian-localize.mjs, writing/arthurian/tools/check-arthurian.mjs | — |
| localize: Record the actual changes | localized from US | writing/arthurian/tools/arthurian-localize.mjs; read: when the master changes, the fingerprint says that it changed, and whether each choice still fits is read | — |
| localize: Link the editions | localized from US | writing/arthurian/tools/arthurian-localize.mjs | — |
| localize: Check and publish together | localized from US | writing/arthurian/tools/arthurian-localize.mjs, writing/arthurian/tools/workshop/check.py#localize_problems, writing/arthurian/tools/workshop/malory.py#publish | — |
| translate: English word order | English word order | writing/arthurian/word-order.tsv, writing/arthurian/tools/workshop/check.py#word_order_problems; read: a French order the list does not hold yet is heard by a reader before it can be listed | word-order.tsv |
| translate: The past tense as English tells it | natural tenses | writing/arthurian/tools/workshop/check.py#pluperfect_problems; read: whether the order of events is already plain is the scene's | — |
| translate: Contractions | contractions | writing/arthurian/contractions.tsv, writing/arthurian/tools/workshop/check.py#contraction_problems | contractions.tsv |
| translate: A neutral tone, strong where the source is strong | neutral tone | writing/arthurian/tools/workshop/check.py#old_turn_problems, writing/arthurian/tools/workshop/check.py#unjudged_problems; read: emphasis the source doesn't give, and a hard word kept hard, are weighed against the source's own force | — |
| translate: "They" for anyone the source leaves open | gender neutral | writing/arthurian/tools/check-arthurian.mjs#englishProblems, writing/arthurian/tools/workshop/check.py#general_he_problems; read: a general "he" in any other shape is known from whom the source means | — |
| translate: No false echoes | no false echoes | read: an echo is heard only by a reader who knows the other story, and a phrase's second sense depends on its scene, as a literal cross carried on the shoulders reads as the idiom "carry your cross" only to a reader who knows it | — |
| translate: Rhythm and source form | prose and verse read aloud; source lines and stanzas kept | writing/arthurian/tools/workshop/check.py#verse_problems, writing/arthurian/tools/workshop/check.py#verse_match_problems, writing/arthurian/tools/workshop/check.py#aloud_problems, writing/arthurian/tools/workshop/check.py#layout_problems; read: slack in a prose sentence is heard by reading it aloud | — |
| translate-old-french: Read the verse | prose and verse read aloud; source lines and stanzas kept | writing/arthurian/tools/workshop/check.py#verse_problems, writing/arthurian/tools/workshop/check.py#verse_match_problems, writing/arthurian/tools/workshop/check.py#aloud_problems; read: the meter is heard, and the read-aloud record says a stanza was read, not how it scans | — |
| translate-latin: Read the verse | prose and verse read aloud; source lines and stanzas kept | writing/arthurian/tools/workshop/check.py#verse_problems, writing/arthurian/tools/workshop/check.py#verse_match_problems, writing/arthurian/tools/workshop/check.py#aloud_problems; read: the meter is heard, and the read-aloud record says a stanza was read, not how it scans | — |
| translate-middle-english: Read the verse | prose and verse read aloud; source lines and stanzas kept | writing/arthurian/tools/workshop/check.py#verse_problems, writing/arthurian/tools/workshop/check.py#verse_match_problems, writing/arthurian/tools/workshop/check.py#aloud_problems; read: the meter is heard, and the read-aloud record says a stanza was read, not how it scans | — |
| translate-middle-welsh: Read the verse | prose and verse read aloud; source lines and stanzas kept | writing/arthurian/tools/workshop/check.py#verse_problems, writing/arthurian/tools/workshop/check.py#verse_match_problems, writing/arthurian/tools/workshop/check.py#aloud_problems; read: the meter is heard, and the read-aloud record says a stanza was read, not how it scans | — |
| translate-middle-high-german: Read the verse | prose and verse read aloud; source lines and stanzas kept | writing/arthurian/tools/workshop/check.py#verse_problems, writing/arthurian/tools/workshop/check.py#verse_match_problems, writing/arthurian/tools/workshop/check.py#aloud_problems; read: the meter is heard, and the read-aloud record says a stanza was read, not how it scans | — |
| translate-old-portuguese-and-spanish: Read the verse | prose and verse read aloud; source lines and stanzas kept | writing/arthurian/tools/workshop/check.py#verse_problems, writing/arthurian/tools/workshop/check.py#verse_match_problems, writing/arthurian/tools/workshop/check.py#aloud_problems; read: which passages of the prose an edition sets as verse is read off its page | — |
| translate: Literary read | scenes read for movement | writing/arthurian/tools/check-arthurian.mjs#literaryPassProblems; read: what a speaker wants and where a scene turns are the story's meaning | — |
| review: A scene or chapter that reads flat | scenes read for movement | read: flatness is a reader's judgment of the scene against its source | — |
| translate: Establish the range against its scan | checked against the scan | writing/arthurian/tools/workshop/check.py#french_problems; read: every flagged line is read against the page image, since the scan is the authority the machine reading is checked against | {source} |
| translate: The edition's apparatus comes out | checked against the scan | writing/arthurian/tools/workshop/check.py#french_problems; read: a side note or running head left in reads as text, and only the page image shows it is the edition's | — |
| translate: Misread letters are restored | checked against the scan | writing/arthurian/tools/workshop/check.py#french_problems; read: every line the tools flag is read against the page image | — |
| translate: A damaged word is settled | checked against the scan | read: which word a damaged one was is settled from the word list and dictionaries, a judgment of the page | — |
| translate: The edition's corrections are applied | checked against the scan | writing/arthurian/tools/workshop/check.py#french_problems | — |
| design: Open everything it cites | checked against the scan | read: a claim checked against what it cites is a reading of that source | — |
| translate-old-french: Read the scan's letters | checked against the scan | writing/arthurian/tools/workshop/check.py#french_problems; read: every flagged line is read against the page image | — |
| translate-latin: Read the scan's letters | checked against the scan | writing/arthurian/tools/workshop/check.py#french_problems; read: every flagged line is read against the page image, and a medieval spelling is the text, not a misread, which only the page shows | — |
| translate-middle-english: Read the scan's letters | checked against the scan | writing/arthurian/tools/workshop/check.py#french_problems; read: every flagged line is read against the page image | — |
| translate-middle-welsh: Read the scan's letters | checked against the scan | writing/arthurian/tools/workshop/check.py#french_problems; read: every flagged line is read against the page image, and the scribe's spelling is the text, not a misread, which only the page shows | — |
| translate-middle-high-german: Read the scan's letters | checked against the scan | writing/arthurian/tools/workshop/check.py#french_problems; read: every flagged line is read against the page image | — |
| translate-old-portuguese-and-spanish: Read the scan's letters | checked against the scan | writing/arthurian/tools/workshop/check.py#french_problems; read: every flagged line is read against the page image | — |
| translate: Name who did it | sources named | writing/arthurian/tools/workshop/check.py#vague_name_problems | — |
| translate: Name the witness behind every reading | sources named | writing/arthurian/tools/workshop/check.py#edition_problems; read: in a box comparing witnesses, which witness a reading came from is read off the witnesses | — |
| translate: A downloaded copy joins the shelf's lists | sources named | writing/arthurian/tools/workshop/shelf.py#sources_problems, writing/arthurian/tools/check-arthurian.mjs#waitProblems | — |
| translate: Never fluent where unsure | honest where unsure | read: where the dictionaries leave a passage open is judged in the source | — |
| translate: Never translate from Malory's wording or a modern edition's | no borrowed wording | writing/arthurian/tools/workshop/check.py#borrowed_problems; read: a modern edition not kept on disk is matched by a reader who knows it | — |
| translate: Apply the combined book's rules | source over Malory | writing/arthurian/tools/workshop/check.py#source_line_problems; read: which telling is the story and which an endnote turns on what each source says | — |
| translate: The source wins | source over Malory | read: where Malory differs from the source is found by reading both | — |
| translate: What Malory adds stays in the story | source over Malory | read: what is Malory's own is found by reading him against his sources | — |
| translate: Where two sources differ | source over Malory | read: whether two tellings differ is found by reading both | — |
| translate: When the order of composition is uncertain | source over Malory | writing/arthurian/tools/workshop/shelf.py#sources_problems; read: holding the comparison open is a judgment of that evidence | — |
| translate: Translate through the manifest | translated by manifest | writing/arthurian/tools/workshop/check.py#manifest_problems, writing/arthurian/tools/workshop/check.py#english_problems | {book}-manifest-phrases.tsv |
| translate: Known phrases first | translated by manifest | writing/arthurian/tools/workshop/check.py#english_problems | — |
| translate: Then known words | translated by manifest | writing/arthurian/tools/workshop/check.py#english_problems, writing/arthurian/tools/workshop/check.py#manifest_problems; read: whether a word's English fits this sense is the moment's | — |
| translate: A phrase another source's manifest already decided | translated by manifest | writing/arthurian/tools/workshop/check.py#cross_manifest_problems; read: whether this source means something different is judged in both texts | — |
| dev: A translation box is worked with /translate | translated by manifest | writing/arthurian/tools/workshop/check.py#usage_problems, writing/arthurian/tools/workshop/check.py#glossary_use_problems; read: that each step was worked in order is the session's, and the files keep only its traces | — |
| translate: Then new choices | every choice logged | writing/arthurian/tools/workshop/check.py#usage_problems, writing/arthurian/tools/workshop/check.py#manifest_problems, writing/arthurian/tools/workshop/check.py#record_english_problems | {book}-manifest-words.tsv |
| design: Decide every open choice | every choice logged | writing/arthurian/tools/check-arthurian.mjs#openChoiceProblems; read: whether each decision says what it wins and costs is the decision's prose, judged by reading it | — |
| dev: Log as you go | every choice logged | writing/arthurian/tools/check-arthurian.mjs#buildRecordProblems; read: whether every run, download and break is in it is the session's | — |
| translate: A changed mind is logged, never quietly applied | changes carried everywhere | writing/arthurian/tools/workshop/check.py#guard_problems | {book}-changes.tsv |
| review: A translation choice | changes carried everywhere | writing/arthurian/tools/workshop/check.py#guard_problems, writing/arthurian/tools/workshop/remanifest.py | — |
| review: Every note is carried through everything it touches in the same pass | changes carried everywhere | writing/arthurian/tools/workshop/hook.py, writing/arthurian/tools/workshop/check.py#guard_problems; read: a note that becomes no check and no manifest row reaches every page only by reading them | — |
| review: The rule first | changes carried everywhere | writing/arthurian/tools/arthurian-made-how.mjs#howProblems; read: which skill owns a rule is a judgment of what the rule governs | — |
| review: Then the check that holds it | changes carried everywhere | writing/arthurian/tools/workshop/check.py#old_turn_problems, writing/arthurian/tools/arthurian-made-how.mjs#howProblems; read: what let the fault through is answered by reading how the rule was held | — |
| review: Then the manifest | changes carried everywhere | writing/arthurian/tools/workshop/remanifest.py, writing/arthurian/tools/workshop/check.py#guard_problems | — |
| review: Then the English | changes carried everywhere | writing/arthurian/tools/workshop/hook.py#pre, writing/arthurian/tools/workshop/check.py#guard_problems | — |
| regen: Regenerate every page already written | changes carried everywhere | writing/arthurian/tools/workshop/retell.py, writing/arthurian/tools/workshop/check.py#guard_problems; read: every page against `made-how.mjs --read`'s list, its literary read included, since those rules are the ones no check holds | — |
| regen: Bring the core up first | changes carried everywhere | writing/arthurian/tools/workshop/check.py#main, writing/arthurian/tools/workshop/shelf.py; read: the order the core came up in is the session's, and the files show only where it ended | — |
| regen: The shelf's lists and the manifest | changes carried everywhere | writing/arthurian/tools/workshop/shelf.py, writing/arthurian/tools/workshop/check.py#manifest_problems; read: whether a row still meets the rules as they stand is weighed by reading it | — |
| regen: The glossary and its notes | changes carried everywhere | writing/arthurian/tools/workshop/check.py#glossary_use_problems, writing/arthurian/tools/workshop/check.py#provenance_problems, writing/arthurian/tools/workshop/check.py#place_problems; read: each entry weighed against the rules as they stand | — |
| regen: Then the outline and the records | changes carried everywhere | writing/arthurian/tools/workshop/check.py#guard_problems, writing/arthurian/tools/workshop/check.py#heading_read_problems, writing/arthurian/tools/workshop/check.py#credit_problems, writing/arthurian/tools/workshop/check.py#localize_problems | — |
| regen: Never past how far a book has got | changes carried everywhere | writing/arthurian/tools/workshop/check.py#guard_problems, writing/arthurian/tools/workshop/check.py#heading_read_problems, writing/arthurian/tools/workshop/check.py#pronoun_read_problems; read: that every built page was read in the regen leaves no stamp on a page that didn't change | — |
| regen: Core out | changes carried everywhere | read: the order the core came up in is the session's, and the files show only where it ended | — |
| translate: Every heading says what happens | story headings | writing/arthurian/tools/workshop/check.py#outline_problems, writing/arthurian/tools/workshop/check.py#spoiler_problems; read: a turn given away in words the check doesn't list is known only from what the story keeps back | — |
| translate: A heading is a plain sentence anyone gets on one read | story headings | writing/arthurian/tools/workshop/check.py#heading_style_problems; read: whether an idea or a person acts in a heading is a matter of sense, which no list of words holds | — |
| translate: One level per real division, never a level skipped | story headings | writing/arthurian/tools/workshop/check.py#outline_problems, writing/arthurian/tools/workshop/check.py#front_label_problems, writing/arthurian/tools/workshop/check.py#matter_order_problems, writing/arthurian/tools/workshop/check.py#divider_problems; read: whether a division is the edition's own is read off its page | — |
| translate: A heading names its own section | story headings | writing/arthurian/tools/workshop/check.py#heading_read_problems | — |
| translate: Headings are unique within a book | story headings | writing/arthurian/tools/workshop/check.py#outline_problems | — |
| translate: The ticket's check tool holds the outline | story headings | writing/arthurian/tools/workshop/check.py#outline_problems, writing/arthurian/tools/workshop/check.py#english_problems | — |
| translate: A book's last range ends on reading the outline alone | story headings | writing/arthurian/tools/workshop/check.py#outline_read_problems; read: the read itself, with the text closed | — |
| ticket: A translation ticket lists its outline | story headings | writing/arthurian/tools/check-arthurian.mjs#outlineListedProblems; read: whether each part says what happens is judged against the book's own story | — |
| translate: The source text carries the same headings | matching outlines | writing/arthurian/tools/workshop/check.py#english_problems | {source} |
| translate: Layout for the screen | laid out for screens | writing/arthurian/tools/workshop/check.py#layout_problems, writing/arthurian/tools/workshop/check.py#mark_problems; read: where a beat turns is the scene's, heard by reading it | — |
| review: A change to how something looks is read where it sits | laid out for screens | writing/arthurian/tools/workshop/check.py#english_problems; read: how a restyled line sits beside its neighbors is seen on the page | — |
| translate: Cite the book it came from | pages linked to scans | writing/arthurian/tools/workshop/check.py#english_problems, writing/arthurian/tools/workshop/check.py#edition_problems, writing/arthurian/tools/workshop/check.py#scan_problems, writing/arthurian/tools/workshop/check.py#source_block_problems | {book}-scans.md |
| translate: The source citation | pages linked to scans | writing/arthurian/tools/workshop/check.py#source_block_problems | — |
| translate: Page markers in the text | pages linked to scans | writing/arthurian/tools/workshop/check.py#english_problems | — |
| translate: Every scan is kept twice | pages linked to scans | writing/arthurian/tools/arthurian-scans.mjs#scanProblems, writing/arthurian/tools/workshop/check.py#scan_problems | — |
| translate: A marker opens its paragraph | pages linked to scans | writing/arthurian/tools/workshop/check.py#english_problems | — |
| translate: No source line under a heading | pages linked to scans | writing/arthurian/tools/workshop/check.py#english_problems | — |
| translate: The sources page | pages linked to scans | writing/arthurian/tools/workshop/check.py#english_problems, writing/arthurian/tools/workshop/check.py#edition_problems, writing/arthurian/tools/workshop/check.py#authority_problems; read: what each work was used for is said in prose, judged against the notes that cite it | — |
| translate: Every passage carries its source line | pages linked to scans | writing/arthurian/tools/workshop/check.py#source_line_problems | — |
| translate: Write the notes | endnotes | writing/arthurian/tools/workshop/check.py#story_note_problems, writing/arthurian/tools/workshop/check.py#footnote_problems; read: what a reader would ask, and so needs a note, is a judgment of what the reader knows | {book}.md#endnotes |
| translate: Endnotes | endnotes | writing/arthurian/tools/workshop/check.py#footnote_problems, writing/arthurian/tools/workshop/check.py#note_place_problems, writing/arthurian/tools/workshop/check.py#note_quote_problems, writing/arthurian/tools/workshop/check.py#note_order_problems; read: whether a note carries only what its sentence can't is weighed against the sentence | — |
| review: An explanation a reader needs | endnotes | writing/arthurian/tools/workshop/check.py#collision_problems; read: whether a term is the text's own or ordinary English used as a title is the passage's | — |
| translate: Malory is an endnote, never a line under a heading | Malory cross-referenced | writing/arthurian/tools/workshop/check.py#map_problems, writing/arthurian/tools/workshop/check.py#published_map_problems, writing/arthurian/tools/workshop/check.py#english_problems; read: whether Malory tells a passage is found by reading his chapter beside it | — |
| review: Mark what this project adds | additions marked | writing/arthurian/tools/workshop/check.py#english_problems; read: whether a note explains or reports the edition's apparatus | {book}.md#new-in-this-translation |
| translate: The voice | — | writing/arthurian/tools/workshop/shelf.py#voice_problems | — |
| translate: Glossary terms | sourced glossary | writing/arthurian/tools/workshop/check.py#glossary_use_problems, writing/arthurian/tools/workshop/check.py#provenance_problems; read: which terms the range needs is a judgment of what the reader knows | GLOSSARY.md |
| glossary: Read the glossaries already written | sourced glossary | read: an older entry is weighed against this passage, never taken as proof that two names are one person | — |
| glossary: Add what this range needs | sourced glossary | writing/arthurian/tools/workshop/check.py#glossary_problems, writing/arthurian/tools/workshop/check.py#provenance_problems; read: a meaning line that tells nothing of what happens later is judged against the story | — |
| glossary: An entry stays once written | sourced glossary | read: an entry taken out leaves nothing in the glossary for a check to find, so the regen's read of the glossary's history holds it | — |
| glossary: Every entry says where it came from | sourced glossary | writing/arthurian/tools/workshop/check.py#provenance_problems | — |
| glossary: Every name opens a card | sourced glossary | writing/arthurian/tools/workshop/check.py#card_problems; read: whether a Wikipedia article is the figure's own, and whether a name stands only in a family tree, are read from the article against the passage | GLOSSARY.md |
| glossary: Headings take the name a modern English reader knows | modern names | writing/arthurian/tools/workshop/check.py#name_problems, writing/arthurian/old-words.tsv, writing/arthurian/tools/workshop/check.py#old_turn_problems; read: which name a modern reader knows is looked up in a standard reference | GLOSSARY.md |
| glossary: Every name a book writes | modern names | writing/arthurian/tools/workshop/names.py, writing/arthurian/tools/workshop/check.py#wikipedia_name_problems; read: whether an article is the figure's own, and a byname another word rather than another spelling, are read from the article against the passage | — |
| translate-old-french: Read the names | modern names | writing/arthurian/tools/workshop/check.py#name_problems, writing/arthurian/tools/workshop/check.py#old_turn_problems; read: which person a form names is read from the passage and a standard reference | — |
| translate-latin: Read the names | modern names | writing/arthurian/tools/workshop/check.py#name_problems, writing/arthurian/tools/workshop/check.py#old_turn_problems; read: which person a form names is read from the passage and a standard reference | — |
| translate-middle-english: Read the names | modern names | writing/arthurian/tools/workshop/check.py#name_problems, writing/arthurian/tools/workshop/check.py#old_turn_problems; read: which person a form names is read from the passage and a standard reference | — |
| translate-middle-welsh: Read the names | modern names | writing/arthurian/tools/workshop/check.py#name_problems, writing/arthurian/tools/workshop/check.py#old_turn_problems; read: which person a form names is read from the passage and a standard reference | — |
| translate-middle-high-german: Read the names | modern names | writing/arthurian/tools/workshop/check.py#name_problems, writing/arthurian/tools/workshop/check.py#old_turn_problems; read: which person a form names is read from the passage and a standard reference | — |
| translate-old-portuguese-and-spanish: Read the names | modern names | writing/arthurian/tools/workshop/check.py#name_problems, writing/arthurian/tools/workshop/check.py#old_turn_problems; read: which person a form names is read from the passage and a standard reference | — |
| glossary: A place says where it is | places located from sources | writing/arthurian/tools/workshop/check.py#place_problems; read: whether an identification is secure is judged on its geographic source | GLOSSARY.md |
| glossary: Never guess which person in another book a figure is | no guessed identities | read: a guess and a sourced identity read alike in a line, and only the cited reference tells them apart | — |
| glossary: No heading or Also: form may be an ordinary word in any book the glossary reaches | no common words glossed | writing/arthurian/tools/workshop/check.py#collision_problems, writing/arthurian/tools/workshop/check.py#name_as_word_problems | — |
| translate: The license | free with credit | writing/arthurian/tools/arthurian-made-with.mjs#creditsPlaceProblems | — |
| regen: The owner's words go in first | — | — | — |
| regen: Find how far each book has got | — | — | — |
| regen: Read the system as it stands | — | — | — |
| regen: Report every change in chat | — | — | — |
| regen: Log it | — | — | — |
| design: Hold it to the method | — | — | — |
| design: Draw what has an order | — | — | — |
| design: Order the phases | — | — | — |
| design: Record what was wrong | — | — | — |
| ticket: Research | — | — | — |
| ticket: Write the ticket | — | — | — |
| ticket: Phases run top to bottom | — | — | — |
| ticket: A ticket that publishes a book | — | — | — |
| dev: No Designed line means /design first | — | — | — |
| dev: Work the phases in order | — | — | — |
| dev: Box after box, in order, without stopping | — | — | — |
| AGENTS: No subagents or workflows | — | — | — |
| AGENTS: Temp files go in the session scratchpad, never in the tree | — | — | — |
| AGENTS: Skills live in writing/.agents/skills/ only | — | — | — |
| translate: Read the ticket and its tools folder's README | — | — | — |
| translate: The source's language goes to its own skill | — | — | — |
| translate-old-french: Every rule of the English is /translate's | — | — | — |
| translate-old-french: A dictionary the ticket names wins where it differs from this skill | — | — | — |
| translate-latin: Every rule of the English is /translate's | — | — | — |
| translate-latin: A dictionary the ticket names wins where it differs from this skill | — | — | — |
| translate-middle-english: Every rule of the English is /translate's | — | — | — |
| translate-middle-english: A dictionary the ticket names wins where it differs from this skill | — | — | — |
| translate-middle-welsh: Every rule of the English is /translate's | — | — | — |
| translate-middle-welsh: A dictionary the ticket names wins where it differs from this skill | — | — | — |
| translate-middle-high-german: Every rule of the English is /translate's | — | — | — |
| translate-middle-high-german: A dictionary the ticket names wins where it differs from this skill | — | — | — |
| translate-old-portuguese-and-spanish: Every rule of the English is /translate's | — | — | — |
| translate-old-portuguese-and-spanish: A dictionary the ticket names wins where it differs from this skill | — | — | — |
| translate: The established source file opens on <!-- source text --> | — | writing/arthurian/tools/check-arthurian.mjs#englishProblems | — |
| translate: The story note | — | writing/arthurian/tools/workshop/check.py#story_note_problems, writing/arthurian/tools/workshop/check.py#published_story_problems, writing/arthurian/tools/workshop/shelf.py#story_problems | — |
| translate: The credits | — | writing/arthurian/tools/arthurian-made-with.mjs#madeWithProblems, writing/arthurian/tools/arthurian-made-with.mjs#creditsPlaceProblems, writing/arthurian/tools/arthurian-made-with.mjs#whyProblems, writing/arthurian/tools/workshop/check.py#credit_problems | — |
| translate: No assistant, tool or service is named or credited | — | — | — |
| translate: Hand a range to a better tool, or for a second opinion | — | — | — |
| translate: The tool and why it is the better one | — | — | — |
| translate: The owner's box first | — | — | — |
| translate: A box after it | — | — | — |
| translate: Close a book by revisiting the made-with line | — | writing/arthurian/tools/arthurian-made-with.mjs | — |
| translate: Anything a range turns up that is not this box's work | — | — | — |
| glossary: Log answers the books can support | — | — | — |
| glossary: Anything else the glossary cannot settle | — | — | — |
| review: The owner's words go in first | — | — | — |
| review: Answer before working | — | — | — |
| review: Hand back | — | — | — |
| review: One line per paragraph | — | — | — |
| design: The owner's words go in first | — | — | — |
| design: Read the ticket and its neighbors | — | — | — |
| design: Date it | — | — | — |
| design: Hand back | — | — | — |
| design: Never translate and never write a tool here | — | — | — |
| design: Anything found that is not this ticket's work is a ticket of its own | — | — | — |
| design: One line per paragraph | — | — | — |
| ticket: The owner's words go in first | — | — | — |
| ticket: Read what is already planned | — | — | — |
| ticket: Options stay options | — | — | — |
| ticket: Index it | — | — | — |
| ticket: Hand back | — | — | — |
| ticket: One line per paragraph | — | — | — |
| ticket: Every date carries its time | — | — | — |
| ticket: Never run git | — | — | — |
| ticket: Anything found that is not this ticket's work is a ticket of its own | — | — | — |
| dev: The owner's words go in first | — | — | — |
| dev: Read the ticket, its row and the running order | — | — | — |
| dev: A > Blocked … line means no build | — | — | — |
| dev: Every box already ticked or struck | — | — | — |
| dev: Date it as building | — | — | — |
| dev: A handoff box ends the session | — | — | — |
| dev: Every box ends in one of four states | — | — | — |
| dev: A piece another tool does better | — | — | — |
| dev: A file a phase writes joins ## What it writes | — | — | — |
| dev: Stop before the checks | — | — | — |
| dev: File what turned up | — | — | — |
| dev: Date it ready to test | — | — | — |
| dev: Hand back | — | — | — |
| dev: Publishing a book copies it into leaftext/app/docs/08-examples/ | — | — | — |
| dev: One line per paragraph | — | — | — |
| test: The owner's words go in first | — | — | — |
| test: Gather the tickets | — | — | — |
| test: Tick the closing box | — | — | — |
| test: Hand back | — | — | — |
| test: One line per paragraph | — | — | — |
| test: A failure that is not the covered ticket's work | — | — | — |
| publish: The owner's words go in first | — | — | — |
| publish: Copy what changed | — | — | — |
| publish: Run the checks | — | — | — |
| publish: Commit and push the writing repository | — | — | — |
| publish: Commit and push leaftext-source | — | — | — |
| publish: Hand over | — | — | — |
| publish: Watch the deploy | — | — | — |
| publish: Check the live pages | — | — | — |
| publish: Hand back | — | — | — |
| publish: One line per paragraph | — | — | — |
| publish: Never commit to ryanallen/leaftext by hand | — | — | — |
| publish: Every commit message ends with the attribution lines the session gives | — | — | — |
| publish: A failure outside the book | — | — | — |
| done: Write what shipped | — | — | — |
| done: Move it | — | — | — |
| done: Update the indexes | — | — | — |
| done: Hand back | — | — | — |
| done: One line per paragraph | — | — | — |
| done: Anything the owner raises | — | — | — |
