The file contains embedded templates which are overly long, making the code hard to understand.

Large chunks of embedded code are generally harder to understand and lower the code health. Consider encapsulating or modularizing the templates so that they become easier to understand.

## Solution

We recommend to be careful here -- just splitting large templates don't necessarily make the code easier to read. Instead, look for natural chunks inside the templates that express a specific task or concern. Use the [EXTRACT FUNCTION](https://refactoring.com/catalog/extractFunction.html) refactoring
to encapsulate that concern.