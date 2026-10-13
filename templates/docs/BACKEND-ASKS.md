# Asks for the backend team, part <n> (<YYYY-MM-DD>)

------------------------------------------------------------------------
HOW TO USE THIS TEMPLATE (delete this block before you send)
- Copy this file to docs/BACKEND-ASKS-<n>.md: one file per part.
- The part travels ALONE: no zip, no extra message, no list of files.
  Everything the backend team needs is inside it.
- Keep it readable as plain text. It may travel through a chat app where
  Markdown does not render: short lines, simple lists, no wide tables.
- Write it fast, from what is already verified (docs/PROGRESS.md, the
  reports). Re-check the code only for a claim that is new and doubtful.
- Ask numbers run across all parts and are never reused. Name the highest
  number used so far in item 4 below.
- Once sent, a part is never edited again. Corrections go in section 2 of
  the next part.
- One priority word per ask: blocking, before the next release, later,
  docs only, optional.
- Delete a section or a head item with nothing in it, and renumber.
  Part 1 keeps only the head, section 4 and section 5.
------------------------------------------------------------------------

Project: {{PROJECT_NAME}}. From: the frontend. Date: <YYYY-MM-DD>.

1. What this part holds. Part <n-1> confirmed (section 1) and corrected on
   <k> points (section 2); the older asks you never received, in full
   (section 3); <m> new asks (section 4); what we need first (section 5).
   This file comes alone, with nothing attached.
2. It reads with part <n-1>. It replaces nothing in part <n-1> except what
   section 2 corrects.
3. First things first: (a) #<N>, <what to do, in one line>.
   (b) #<N>, <what to do, in one line>.
4. New ask numbers: #<first> to #<last>. The highest number before them is
   #<k>, in part <n-1>.


## 1. Part <n-1>, confirmed

The open questions of part <n-1>, answered. Each line: where it was, the
question, the answer.

1. Section <s>, #<N>. <The question, in one line?> <The answer, and what it
   means for you.>
2. Section <s>, #<N>. <The question?> <The answer.>


## 2. Part <n-1>, corrected

<k> corrections; the rest of part <n-1> stands.

1. #<N>, <title>. Part <n-1> said <what>. In fact, <what>. What changes for
   you: <nothing | what>.


## 3. The asks you never received, still open

<Why they are here, in one line. For example: your reply said part <p>
never reached you.> Each ask is copied below in full, as first written.
Line numbers in them may have moved. If one is no longer true on your
side, tell us.

The state of each, today:
- #<N>, <title>: never received. <priority>.
- #<N>, <title>: partly answered; still wanted: <what>. <priority>.

### #<N>. <Title, as first written>

<The full text of the ask, copied as it was.>

State today: <never received | partly answered: what is still wanted>.
Priority: <priority>.


## 4. New asks

### #<N>. <The problem in one line, not the fix>

Found <YYYY-MM-DD>, while <building or testing what>. Priority: <priority>.

The product rules (the conception): <what they say, with the section>.

The backend today: <what it does, with the route, the doc section, or the
file and line>.

Ask: <exactly what to change or to answer: fields, status codes, error
codes>.

The frontend meanwhile: <what the screen does until then>.


## 5. What we need first

1. #<N>: <why it comes first>.
2. #<N>: blocking.
3. The rest, by their priority words.
