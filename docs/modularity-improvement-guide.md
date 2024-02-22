**Problem**: Most code smells stem from a lack of modularity. Often, a single function does too many things and contain too much logic. This overwhelms a human reader. A lack of modularity also makes the code harder to refactor.

## Solution

1. Look for opportunities to modularize the design. This is done by identifying the different responsibilities inside the function.
2. Once identified, then use refactorings like [Extract Function](https://refactoring.com/catalog/extractFunction.html) or even [Extract Class](https://refactoring.com/catalog/extractClass.html).

**Why is this better?**  By breaking larger functions into smaller, well-encapsulated building blocks, you prepare for more impactful refactorings.
