# commit

Create a git commit using Conventional Commits format.

## Instructions

1. Run `git status` and `git diff` to see what needs to be committed
2. Run `git add` on specific files as needed
3. Run `git diff --staged` to see what will be committed
4. Analyze the changes and draft a Conventional Commits message
5. Keep the subject line to at most 100 characters, in the form `type: imperative summary`, with no trailing period. Put the why in the body
6. Keep the message body concise - explain the what/why, not the how. Don't repeat what's already visible in the diff
7. Ensure that the message body is wrapped at approximately 80 columns
8. Surround all code references in backticks
9. Create the commit. The commit-msg hook runs commitlint and rejects an invalid message
10. Run `make lint`.
