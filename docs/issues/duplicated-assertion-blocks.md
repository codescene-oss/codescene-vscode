This test file has several blocks of duplicated assertion statements. Avoid adding more.

Just like duplicated logic in application code is problematic, duplicated test criteria lead to code that's hard to maintain. Duplicated assertion blocks usually indicate a missing abstraction, either a supporting test function or a specific test is missing.

## Solution

Consider to encapsulate the duplicated assertions (i.e. test criteria) in a custom assert statement that you can then re-use. We also recommend to consider the granularity of the tests; sometimes a single test tests too many things; extracting smaller tests can usually help you get rid of the duplication.
