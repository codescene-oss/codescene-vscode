# CodeScene - Code Analysis and Refactoring
[![CodeScene Code Health](https://codescene.io/projects/36131/status-badges/code-health)](https://codescene.io/projects/36131)

✨ New: Code Health Monitor and ACE AI-Powered Refactoring! ✨

[CodeScene](http://www.codescene.com) - the only code analysis tool with a proven business impact. Now also with AI-Powered Refactoring.

![screenshot3](screenshots/review-showcase.gif)


### Table of Contents
1. [ACE — AI-Powered Auto-Refactoring ✨**New**✨](#augmented-code-engineering)
2. [Code Health Monitor ✨**New**✨](#code-health-monitor)
3. [Code Health Analysis](#code-health) 
4. [Code Smells Guide](#code-smells)

## Augmented Code Engineering 
[CodeScene ACE](https://codescene.io/docs/auto-refactor/index.html) combines multiple LLMs with fact-based validation. ACE chooses the best LLM for the job, validates its output, and proposes refactorings for cleaner code which is easier to maintain.

![screenshot3](screenshots/auto-refactor-showcase.gif)

ACE supported languages:
- java
- javascript
- typescript
- javascriptreact
- typescriptreact

ACE supported code smells:
- Complex Conditional
- Bumpy Road Ahead
- Complex Method
- Deep, Nested Complexity
- Large Method

Also, only functions under 130 lines (200 for java) of code will be considered for refactoring (ignoring commented lines).

## Code Health Monitor
Track code health in real-time as you work. The Monitor highlights code smells and offers AI-powered refactoring to improve your code.
![Refactor as you go](screenshots/refactor-as-you-go.png)

## Code Health Analysis
CodeScene’s [Code Health](https://codescene.io/docs/guides/technical/code-health.html) metric is the software industry’s only code-level metric with proven business impact, measured through fact-based, winning research. It’s a metric that you can trust.

The extension analyses and scores your code as you type, and adds diagnostic items that highlights any [code smells](#code-smells).

### Language support
CodeScene supports [most popular languages](https://codescene.io/docs/usage/language-support.html#supported-programming-languages).


### Custom Code Health rules
To customize the code analysis you can either use local [Code Comment Directives](https://codescene.io/docs/guides/technical/code-health.html#disable-local-smells-via-code-comment-directives) or create a `code-health-rules.json` file which applies to the entire project.  


## Code Smells

Code smells often lead to issues such as increased technical debt, more bugs, and reduced overall quality of the software.

You can find detailed information for each code smell by either clicking the corresponding codelens in the editor, by examining the diagnostics (squigglies or in the Problems view), or by using the Quick Fix action menu (light bulb).



