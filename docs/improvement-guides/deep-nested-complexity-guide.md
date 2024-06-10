**Problem**: Deep nested complexity is `if`-statements inside other `if`-statements and/or loops, increasing the cognitive load on the programmer.

## Solution

* See if it's possible to [Replace Nested Conditional with Guard Clauses](https://refactoring.com/catalog/replaceNestedConditionalWithGuardClauses.html).
* Look for opportunities to [Replace Conditional with Polymorphism](https://refactoring.com/catalog/replaceConditionalWithPolymorphism.html).
* Identify smaller building blocks inside the nested code. Use [Extract Function](https://refactoring.com/catalog/extractFunction.html) to encapsulate those responsibilities in smaller and more cohesive functions.

**Why is this better?** Rethinking the nesting reduces the cognitive load on the programmer reading the code.