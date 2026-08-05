# AI Providers

The provider integration language shared by Pi's model APIs and transports.

## Language

**Special Recovery Error**:
A provider failure whose recovery contract is defined independently of the general provider retry policy.
_Avoid_: Generic transient error

**General Stream Failure**:
An in-band provider failure that has no dedicated recovery contract.
_Avoid_: Transport error

**Terminal Stream Failure**:
A stream failure known not to improve when the same request is replayed.
_Avoid_: Permanent transport error

**Replay-Safe Boundary**:
The point before a response attempt has produced assistant content. Provider metadata alone does not cross this boundary.
_Avoid_: Stream start
