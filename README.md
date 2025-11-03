# CodeScene - Code Analysis and Refactoring
[![CodeScene Code Health](https://codescene.io/projects/36131/status-badges/code-health)](https://codescene.io/projects/36131)

## What is CodeScene for Visual Studio Code? ##
[CodeScene](http://www.codescene.com) is the only code analysis tool with a **proven business impact**. It serves as a **safeguard** against introducing code changes that could negatively affect your business outcomes.

CodeScene promotes **healthy, maintainable code** by providing clear, actionable insights and guidance on how to improve your codebase.

With an add-on **Automatic Refactoring**, CodeScene can even automate parts of the improvement process—helping developers enhance code quality and maintainability faster and more accurately.

By using CodeScene, developers can spend less time deciphering and refactoring code, and more time focusing on what truly matters: **solving problems and delivering value**.

## The CodeScene CodeHealth™ metric ##
CodeScene’s [CodeHealth™](https://codescene.io/docs/guides/technical/code-health.html) metric is the software industry’s only code-level metric with proven business impact, measured through fact-based, winning research. It’s a metric that you can trust. The extension analyses and scores your code as you type, and adds diagnostic items that highlights any [code smells](#code-smells).
CodeScene supports [most popular languages](https://codescene.io/docs/usage/language-support.html#supported-programming-languages).

## Safeguarding your code changes ##
Instant feedback is vital for maintaining high-quality code during development. By analyzing code as it’s written, developers may identify issues immediately. This interactive feedback loop encourages better coding habits, speeds up learning, and reduces the need for extensive rework later. 

Continuous feedback fosters a sense of flow and confidence, as you instantly can see the impact of your changes on overall code health. In short, interactive monitoring turns code quality from a delayed review process into a **continuous, integrated part of writing code**, ensuring long-term maintainability and faster, safer development.

The **Code Health Monitor** flags for drops in code health in real time and offers instant recommendations to keep your code maintainable.

<img style="margin: 10px 10px 10px 10px;" src="screenshots/monitor.gif" width="500">

> **_NOTE:_** _The Code Health Monitor is currently available to all users for a limited time period. However, this capability will become accessible only to CodeScene customers in future_.

## Automatic Refactoring in ACE ##
[CodeScene ACE](https://codescene.io/docs/auto-refactor/index.html) helps you with the hardest part of software development: maintaining and improving existing code. While other AI tools focus on code generation, CodeScene ACE fixes technical debt and refactors code smells directly in your IDE. With fact-based metrics, ACE focuses on the impactful improvements you can do now to simplify your tasks. Maintain momentum, and let ACE handle the heavy lifting for you.

<img style="margin: 10px 10px 10px 10px;" src="screenshots/auto-refactor-showcase.gif" width="1000">

> **_NOTE:_** _CodeScene ACE is an AI-Powered service that is not accessible by default. All AI technology is hosted seperately, and can only be utilized by consent of your organisation. It must be explicitly activated in order to become available via the CodeScene IDE extension. If you are interested in purchasing ACE for your organisation or just want to conduct a trial, please contact [Sales](https://codescene.com/product/talk-to-sales)_.

## Overview of Available Features ##
| Feature | Description | What it looks like |
|---------|-------------|--------------------|
| **Code Health Monitor*** | The Code Health Monitor continuously tracks changes in your code, highlighting any improvements or degradations you introduce. Each file displays both its previous and current Code Health score, along with a clear delta value showing the overall change. You can easily see the impact of your modifications at the file or function level, including the status of any associated Code Smells—whether you’ve introduced new ones or resolved existing issues. With this level of visibility, there’s no longer any excuse for allowing Code Health to decline in your codebase. | <img style="margin: 10px 10px 10px 10px;" src="screenshots/monitor.png" alt="Monitor" width="2000px"/> |
| **Automatic Refactoring**** | <div>CodeScene ACE enables automatic refactoring within the CodeScene IDE extension. Code Smells detected during code analysis can be flagged for automatic refactoring, and any changes identified by the Code Health Monitor that have refactoring potential are also considered. ACE selects the most suitable AI model for each task and validates the results to ensure that only relevant and high-quality refactorings are presented. Each suggested refactoring includes a confidence evaluation and highlights any potential concerns, giving developers clear guidance and control over improvements to their code.</div><p></p><div>These are the languages that ACE can refactor:</div><ul><li>Java</li><li>C#</li><li>C++</li><li>JavaScript</li><li>TypeScript</li><li>React additional support (works with JavaScript and TypeScript)</li></ul><div>ACE is currently capable to refactor a subset of Code Smells that may be detected:</div><ul><li>Complex Conditional</li><li>Bumpy Road Ahead</li><li>Complex Method</li><li>Deep, Nested Complexity</li><li>Large Method</li></ul> | <img style="margin: 10px 10px 10px 10px;" src="screenshots/ace.png" alt="ACE" width="2000px"/> |
| **Inline Code Smell detection** | Code smells often lead to issues such as increased technical debt, more bugs, and reduced overall quality of the software. You can find detailed information for each code smell by either clicking the corresponding inline action notation in the editor, by examining the diagnostics (squigglies or in the Problems view), or by using the Quick Fix action menu (light bulb).| <img style="margin: 10px 10px 10px 10px;" src="screenshots/codesmells.png" alt="Code Smells" width="2000px"/> |
| **Refactoring Guidance** | Our mission is to educate and raise awareness about Code Health and its impact on your efficiency as a developer. The CodeScene extension equips you with rich insights into Code Smells and provides clear, actionable guidance on how to address issues that may exist in your codebase. We include relevant examples that illustrate the essence of Code Smells, along with common patterns and practical solutions to help you write cleaner, more maintainable code. | <img style="margin: 10px 10px 10px 10px;" src="screenshots/documentation.png" alt="Code Smell Documentation" width="2000px"/> |
| **Problems View** | When a file is opened in the editor, it is instantly scanned for existing Code Health issues. All discovered issues are then listed in the IDE Problems View. This way you instantly get an overview of all opportunities a file has for improvements. | <img style="margin: 10px 10px 10px 10px;" src="screenshots/problems.png" alt="Problem View" width="2000px"/> |
| **Custom Code Health rules** | To customize the code analysis you can either use local [Code Comment Directives](https://codescene.io/docs/guides/technical/code-health.html#disable-local-smells-via-code-comment-directives) or create a `code-health-rules.json` file which applies to the entire project. | <img style="margin: 10px 10px 10px 10px;" src="screenshots/custom_directive.png" alt="ACR" width="2000px"/> |


_* Available time-limited for non CodeScene customers._

_** Paid add-on feature._
