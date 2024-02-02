**Problem**: Complex conditionals are expressions with multiple logical operators (e.g. `&&`, `||`), making the code harder to read.

## Solution

* Apply the [Decompose Conditional](https://refactoring.com/catalog/decomposeConditional.html) refactoring to encapsulate the expression in a separate function with a good name that captures the business rule. 
* For simple expressions, use the [Introduce Explaining Variable](https://refactoring.com/catalog/extractVariable.html) refactoring.

**Why is this better?** This refactoring captures the business rule in a well-named function, making the primary function easier to understand.