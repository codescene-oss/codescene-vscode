This file contains too many functions. Beyond a certain threshold, more functions lower the code health.

## Solution

Modules with too many functions are generally harder to understand. Such modules should likely be split into smaller and more cohesive units, e.g. by using the refactoring [EXTRACT CLASS](https://refactoring.com/catalog/extractClass.html).

Modules with too many functions are also at risk of evolving into a **Brain Class**. Brain classes are problematic since changes become more complex over time, harder to test, and challenging to refactor. Act now to prevent future maintenance issues.