The functions in this file have too many arguments, indicating a lack of encapsulation or too many responsibilities in the same functions. Avoid adding more.

This code health issue is measured as the average number of function arguments across the whole file. A function with many arguments can be simplified either by 
- splitting the function if it has too many responsibilities, or 
- introducing an abstraction (class, record, struct, etc.) which encapsulates the arguments. 

## Solution

Start by investigating the responsibilities of the function. Make sure it doesn't do too many things, in which case it should be split into smaller and more cohesive functions. Consider the refactoring [INTRODUCE PARAMETER OBJECT](https://refactoring.com/catalog/introduceParameterObject.html) to encapsulate arguments that refer to the same logical concept.