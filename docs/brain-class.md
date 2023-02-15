Brain Class

A Brain Class -- aka a God Class -- is a large module with too many responsibilities. A module is a Brain Class if: it's a large module with many lines of code, it has many functions, and at least one Brain Method. 

Brain Classes are problematic since changes become more complex over time, harder to test, and challenging to refactor the longer you wait.

## Solution

Look for opportunities to modularize the design. This is done by 
identifying groups of functions that represent different responsibilities and/or operate 
on different data. 
Once you have identified the different responsibilities, then use refactorings 
like [EXTRACT CLASS](https://refactoring.com/catalog/extractClass.html).
