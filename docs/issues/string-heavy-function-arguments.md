The functions in this file have a high ratio of strings as arguments. Avoid adding more.

Heavy usage of built-in string types indicate a missing domain language. There are also validation implications since code needs to be written that checks the semantics of the string type.

## Solution

Introduce data types that encapsulate the semantics. For example, a `user_name` is better represented as a constrained `User` type rather than a pure string, which could be anything.