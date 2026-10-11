// Course membership uses the existing persisted prompt tags contract.
// Titles are deliberately not treated as allocation evidence.
export const WRITING_COURSES = Object.freeze(['1', '2', '3', '4', '5']);
const courseOf = (tag) => typeof tag === 'string' ? /^course:([1-5])$/.exec(tag.trim())?.[1] : undefined;

export function promptCourses(tags) {
  const values = new Set(Array.isArray(tags) ? tags.map(courseOf).filter(Boolean) : []);
  return WRITING_COURSES.filter((course) => values.has(course));
}

export function promptContentTags(tags) {
  return Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string' && !courseOf(tag)) : [];
}

export function tagsWithCourses(tags, courses) {
  return [...new Set([
    ...promptContentTags(tags).map((tag) => tag.trim()).filter(Boolean),
    ...WRITING_COURSES.filter((course) => courses?.includes(course)).map((course) => `course:${course}`),
  ])];
}

export function matchesPromptCourse(tags, filter) {
  const courses = promptCourses(tags);
  if (filter === 'unassigned') return courses.length === 0;
  return !WRITING_COURSES.includes(filter) || courses.includes(filter);
}

export function promptCourseFilter(value) {
  return value === 'unassigned' || WRITING_COURSES.includes(value) ? value : '';
}

export function promptTagsEqual(left, right) {
  return left.length === right.length && left.every((tag) => right.includes(tag));
}
