---
title: Git in the editor
---

The desktop application can look at the git repository your documents live in, show what has changed, record a commit and push it. It uses the `git` already installed on your machine, with your own configuration, your credential helper and your ssh agent — a commit made here is a commit you could have made in your terminal, under your own name.

Nothing happens on its own. The editor never fetches, never pulls, never commits without being asked.

## Git button

A **git button** appears in the toolbar when the application runs on the desktop. Hovering it opens the panel; hovering the button itself shows the state in one line — the branch, how many files have changed, and how many commits are waiting to be pushed.

The repository is the one containing the folder of the document in the active tab. Several projects open in several tabs therefore each show their own.

## The panel

The panel shows the files that differ from the last commit, each with git's two status letters and its path. Only files worth versioning are listed: documents, images, Python files, notebooks and YAML. What the editor writes beside your documents — the sidecars holding cell outputs, the build folders, the plugins it installs — is left out, so a commit never sweeps up something you did not write.

Untracked files are listed too, since a new chapter has to be able to enter the repository.

Clicking any file opens its **diff**: what the document says now, against what it said at the last commit. Unchanged passages are collapsed. An image is listed but not shown — there is nothing to compare.

## Committing

**Review and commit…** opens the same diff for every changed file at once, with a checkbox on each. Unchecking one leaves it out of the commit without undoing anything; it stays as it is, waiting for a later one. A chevron folds a file's diff once you have read it, which is independent of whether it is included.

Below the diffs, a summary line and a longer description. The commit message is the two joined, as git expects them.

⚠️ Before anything is read, **every tab with unsaved work is written to disk**. Git reads files, not editors: without that, a document you had just edited — and were looking at in the diff — would have been committed in its previous state.

## Pushing

When the branch tracks another and has commits it does not, the panel offers to push them. The button names the destination.

Authentication is your machine's. A key held by an ssh agent, or a credential helper such as the macOS keychain, works without the editor seeing anything. What cannot work is a password typed into a terminal: the editor has no terminal to type it in, so git is told not to ask and reports the problem instead of waiting for an answer nobody can give. If a push stops responding for another reason, it is abandoned after a minute and whatever git had already said is shown.

A failed push leaves its message on screen until you dismiss it, because that message is what tells you whether to try again or to open a terminal.

## What it deliberately absent

**Pull, merge and rebase.** These rewrite files in place, possibly under a document you have open, and a conflict is not something to resolve in a preview pane. The panel tells you when your branch is behind — as of your last fetch, since it does not fetch by itself — and leaves the rest to your terminal.

**Branches.** You stay on the branch you are on. Switching changes every file in the folder at once, which is not a thing to do by accident while writing.

**Partial commits.** A file goes in whole or not at all. Committing twice is the way to separate two changes that ended up in one document.

These are not permanent limits, but each of them can lose work when it goes wrong, and none of them is harder from a terminal than it is worth making safe here.
