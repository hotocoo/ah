package stack

// Stack is a LIFO stack of T.
// Push(v T) adds v on top.
// Pop() (T, bool) removes and returns the top value; false when empty.
// Peek() (T, bool) returns the top value without removing it; false when empty.
// Len() int and IsEmpty() bool report the size.
type Stack[T any] struct {
}
