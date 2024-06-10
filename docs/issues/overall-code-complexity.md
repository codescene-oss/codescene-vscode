This file has many conditional statements (e.g. if, for, while) across its implementation, leading to lower code health. Avoid adding more conditionals.

Code complexity is detected by the [cyclomatic complexity](https://en.wikipedia.org/wiki/Cyclomatic_complexity) metric, which counts the number of conditional statements. Cyclomatic complexity indicates the minimum number of unit tests you would need for the implementation in this file. The more tests you need, the more complicated the method. This code smell indicates that the whole implementation would benefit from being simplified.

## Solution

Start by addressing possible bumpy road and/or deeply nested logic issues if applicable. This will help you lower the average cyclomatic complexity too.

You can then address the overall cyclomatic complexity by a) modularizing the code, and b) abstract away the complexity. Let's look at some examples:

- Modularizing the Code: Do an X-Ray and inspect the local hotspots. Are there any complex conditional expressions? If yes, then do a [DECOMPOSE CONDITIONAL](https://refactoring.com/catalog/decomposeConditional.html) refactoring. Extract the conditional logic into a separate function and put a good name on that function. This clarifies the intent and makes the original function easier to read. Repeat until all complex conditional expressions have been simplified.
- In an object-oriented language, conditionals can often be replaced with polymorphic calls (see the design patterns [STRATEGY](https://en.wikipedia.org/wiki/Strategy_pattern) and [COMMAND](https://en.wikipedia.org/wiki/Command_pattern) -- they often help).
- In a functional programming language, conditionals can often be replaced by pipes of filter, remove, reduce, etc.
- You also want to inspect the code and see if it seems to do more than one thing. If yes, then consider the [EXTRACT FUNCTION](https://refactoring.com/catalog/extractFunction.html) refactoring.
