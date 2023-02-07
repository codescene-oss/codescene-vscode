Deeply nested function

Deeply nested logic means that you have control structures like if-statements or loops inside other control structures. Deeply nested logic increases the cognitive load on the programmer reading the code. The human working memory has a maximum capacity of 3-4 items; beyond that threshold, we struggle with keeping things in our head. Consequently, deep nested logic has a strong correlation to defects and accounts for roughly 20% of all programming mistakes.

Occassionally, it's possible to get rid of the nested logic withe the [REPLACING CONDITIONALS WITH GUARD CLAUSES](https://refactoring.com/catalog/replaceNestedConditionalWithGuardClauses.html) refactoring.

Another viable strategy is to identify smaller building blocks inside the
nested chunks of logic and extract those responsibilities into smaller, cohesive, and well-named functions. The [EXTRACT FUNCTION](https://refactoring.com/catalog/extractFunction.html) refactoring explains the steps.