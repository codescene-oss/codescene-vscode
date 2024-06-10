A complex conditional is an expression inside a branch such as an `if`-statement which consists of multiple, logical operations. Example: `if (x.started() && y.running())`. Complex conditionals make the code even harder to read, and contribute to the **Complex method** code smell. Encapsulate them. By default, CodeScene warns only if there are at least 2 logical operators, but encapsulation can be valuable even with just one.

## Example
```javascript
function messageReceived(message, timeReceived) {
   // Ignore all messages which aren't from known customers:
   if (!message.sender &&
       customers.getId(message.name) == null) {
     log('spam received -- ignoring');
     return;
   }

  // Provide an auto-reply when outside business hours:
  if ((timeReceived.getHours() > 17) ||
      (timeReceived.getHours() < 8 ||
      (timeReceived.getDay() == Days.SUNDAY))) {
    return autoReplyTo(message);
  }

  pingAgentFor(message);
}
```

## Solution
Apply the [DECOMPOSE CONDITIONAL](https://refactoring.com/catalog/decomposeConditional.html) refactoring so that the complex conditional is encapsulated in a separate function with a good name that captures the business rule. Optionally, for simple expressions, introduce a new variable which holds the result of the complex conditional.

Here we improve upon our example by using this tactic:

```javascript
function messageReceived(message, timeReceived) {
   if (!fromKnownCustomer(message)) {
     log('spam received -- ignoring');
     return;
   }

  if (outsideBusinessHours(timeReceived)) {
    return autoReplyTo(message);
  }

  pingAgentFor(message);
}
```

For brevity the separate functions are omitted. Note also how the clear naming omits the need for extra comments.