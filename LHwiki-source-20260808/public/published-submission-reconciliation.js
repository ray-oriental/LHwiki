export function hasUnlistedApprovedSubmission(articles = [], submissions = []) {
  const listed = new Set(
    articles.map(article => [
      article?.section_slug,
      article?.title,
      article?.author_label
    ].map(value => String(value ?? '')).join('\u0000'))
  );

  return submissions.some(submission => submission?.status === 'approved'
    && !listed.has([
      submission.section_slug,
      submission.title,
      submission.author_label
    ].map(value => String(value ?? '')).join('\u0000')));
}
