This file is large in terms of lines of code and has accumulated many functions. Together, this indicates that the file could degrade into a **Brain Class** unless acted upon.

This is an early warning that the software design starts to get problematic. Look for opportunities to modularize the code by separating related groups of functions into new cohesive files/classes/modules.

## Solution

Look for opportunities to modularize the design. This is done by identifying groups of functions that represent different responsibilities and/or operate on different data.

Once you have identified the different responsibilities, then use refactorings like [EXTRACT CLASS](https://refactoring.com/catalog/extractClass.html).
