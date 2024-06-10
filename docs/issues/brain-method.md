A *brain method* is a large and complex function that centralizes the behavior of the module.

Brain methods, as described in Object-Oriented Metrics in Practice, by Lanza and Marinescu, are detected using a
combination of other code issues:

- Deeply nested Logic
- High cyclomatic complexity
- Many lines of code
- Accesses many arguments

The more complex the brain method, the lower the code health.

## Solution

A brain method lacks modularity and violates the [Single Responsibility Principle](https://en.wikipedia.org/wiki/Single-responsibility_principle).

Refactor by identifying the different responsibilities of the brain method and extract them into separate well-named and cohesive functions. Often, a brain method can - and should - be extracted to a new class that encapsulates the responsibilities and can be tested in isolation.