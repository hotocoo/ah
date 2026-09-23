use std::collections::HashMap;

/// Counts words case-insensitively, ignoring ASCII punctuation, and returns the
/// `n` most frequent as (word, count), sorted by count desc then word asc.
pub fn top_words(text: &str, n: usize) -> Vec<(String, usize)> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for raw in text.split_whitespace() {
        let word: String = raw.chars().filter(|c| !c.is_ascii_punctuation()).collect().to_lowercase();
        if word.is_empty() {
            continue;
        }
        *counts.entry(word).or_insert(0) += 1;
    }
    let mut v: Vec<(String, usize)> = counts.into_iter().collect();
    v.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)));
    v.truncate(n);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_and_orders() {
        let r = top_words("the cat. The dog! the end, cat", 2);
        assert_eq!(r, vec![("the".to_string(), 3), ("cat".to_string(), 2)]);
    }
}
