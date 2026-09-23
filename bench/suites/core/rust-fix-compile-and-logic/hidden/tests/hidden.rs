use wordfreq::top_words;

#[test]
fn ties_sorted_alphabetically() {
    assert_eq!(top_words("b a c b a", 3), vec![("a".into(), 2), ("b".into(), 2), ("c".into(), 1)]);
}

#[test]
fn empty() {
    assert!(top_words("!!! ...", 5).is_empty());
}
