This test file has several blocks of large, consecutive assert statements. Avoid adding more.

Large blocks with consecutive assertions indicate a missing abstraction. Often, large assert blocks lead to duplicated test criteria too. Consider extracting and encapsulating custom assertions that communicate the test criteria in the language of your domain.

## Example

Here is an example of test code with a large assertion block:
```java
@Before
public void createDamagedBot() {
    robT1000 = new Shapeshifting_T_1000();

    // .. lots of other code here..
}

@Test
void autoRepairsWhenDamaged() {
    robT1000.heal();

    assertEquals(100, robT1000.cpuCapacity());
    assertTrue(robT1000.ramCheckPasses());
    assertTrue(robT1000.diskAccessible());
    assertEquals(100, robT1000.vision());
    assertEquals(CONSTANTS.FUNCTIONAL, robT1000.equipment());
```

## Solution

Consider encapsulating the duplicated assertions (i.e. test criteria) in a custom assert statement that you can then re-use.
We also recommend to consider the granularity of the tests; sometimes a single test tests too many things; extracting smaller tests can usually help you get rid of the duplication.

Working with the previous example, and the idea of encapsulation in a custom assert statement, we can make an attempt at straightening out the code:
```java
@Before
public void createDamagedBot() {
    robT1000 = new Shapeshifting_T_1000();

    // .. lots of other code here..
}

@Test
void autoRepairsWhenDamaged() {
    robT1000.heal();

    // Replace the low-level assertions with a custom assert that lets
    // us communicate in the language of our domain. Also encapsulates
    // the criteria so that we only have one place to change if/when
    // more properties are added.
    // Most test frameworks have support for custom asserts.
    assertFullyOperational(robT1000);
}
```
