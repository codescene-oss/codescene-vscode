**Problem**: Large methods containing an excessive number of code lines are generally harder to understand compared to code that has been broken up into smaller logical chunks.

## Solution

Overly long functions make the code harder to read, but we recommend being careful here - just splitting long functions doesn't necessarily make the code easier to read. Instead, look for natural chunks inside the functions that expresses a specific task or concern. Often, such concerns are indicated by a Code Comment followed by an if-statement. Use the [EXTRACT FUNCTION](https://refactoring.com/catalog/extractFunction.html) refactoring to encapsulate that concern.