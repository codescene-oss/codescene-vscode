Excess number of function arguments

Functions with many arguments indicate either

- low [cohesion](./low-cohesion.md) where the function has too many responsibilities, or
- a [missing abstraction](./missing-arguments-abstractions.md) that encapsulates those arguments.

## Solution

Start by investigating the responsibilities of the function. Make sure it doesn't do too many things, in which case it should be split into smaller and more cohesive functions.

Consider the refactoring [INTRODUCE PARAMETER OBJECT](https://refactoring.com/catalog/introduceParameterObject.html) to encapsulate arguments that refer to the same logical concept.