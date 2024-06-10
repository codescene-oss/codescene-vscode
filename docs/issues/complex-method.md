A complex method is a function with a high cyclomatic complexity. Cyclomatic complexity counts the number of logical paths through a function. That is, each if-statement, each control structure like a for or while loop adds complexity. We count them and sum it up to get a complexity value.

It's somewhat of a crude metric, because whether or not the function is difficult to understand
may depend on other factor as well, such as how deeply nested the code is.

## Solution

The solution heavily depends on specifics of the function. Sometimes when the cyclomatic complexity gets too high, another design approach is beneficial such as

- modeling state using an explicit state machine rather than conditionals, or
- using table lookup rather than long chains of logic.

In other scenarios, the function can be split using [EXTRACT FUNCTION](https://refactoring.com/catalog/extractFunction.html). Just make sure you extract natural and cohesive functions. Complex Methods can also be addressed by identifying complex conditional expressions and then using the [DECOMPOSE CONDITIONAL](https://refactoring.com/catalog/decomposeConditional.html) refactoring.