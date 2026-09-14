'use strict';

const CANONICAL_VOCABULARY_CATEGORY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Select only a topic slug that the Vocabulary importer will preserve verbatim. */
function selectCanonicalVocabularyTopic(value) {
  const topics = Array.isArray(value)
    ? value.filter((topic) => (
      topic
      && typeof topic === 'object'
      && typeof topic.slug === 'string'
      && CANONICAL_VOCABULARY_CATEGORY.test(topic.slug)
    ))
    : [];
  return topics.find((topic) => topic.is_published !== false) || topics[0] || null;
}

module.exports = { selectCanonicalVocabularyTopic };
