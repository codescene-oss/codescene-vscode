**Problem**: Bumpy Roads are functions with multiple chunks of nested conditional logic, often indicating too many responsibilities in the same function.

## Solution

1. Identify the most severe bumps: more lines of code with more logic amplifies the code smell.
2. Apply the [EXTRACT FUNCTION](https://refactoring.com/catalog/extractFunction.html) refactoring to encapsulate each bump. 
3. Look for opportunities to simplify the conditional logic, eg. by [Replace Nested Conditional with Guard Clauses](https://refactoring.com/catalog/replaceNestedConditionalWithGuardClauses.html). 

**Why is this better?** Encapsulating each bump in a well-named function simplifies the algorithm, and often suggests a more impactful refactoring as a next step.