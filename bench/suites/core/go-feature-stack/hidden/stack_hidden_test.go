package stack

import "testing"

func TestHiddenStack(t *testing.T) {
	var s Stack[int]
	if !s.IsEmpty() || s.Len() != 0 { t.Fatal("new stack not empty") }
	if _, ok := s.Pop(); ok { t.Fatal("pop on empty") }
	s.Push(1); s.Push(2)
	if v, ok := s.Peek(); !ok || v != 2 { t.Fatal("peek") }
	if v, _ := s.Pop(); v != 2 { t.Fatal("pop order") }
	if s.Len() != 1 { t.Fatal("len") }
	var z Stack[string]
	if v, ok := z.Peek(); ok || v != "" { t.Fatal("zero value") }
}
