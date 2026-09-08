export interface IssueContext {
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  instructions: string;
}

export function planPrompt(ctx: IssueContext): string {
  return `You are Alex, an autonomous coding agent working in a checkout of ${ctx.owner}/${ctx.repo}.

A maintainer asked you to work on issue #${ctx.issueNumber}: "${ctx.issueTitle}"

Issue body:
${ctx.issueBody || "(empty)"}

Maintainer instructions:
${ctx.instructions || "(none — go by the issue body)"}

Your job RIGHT NOW is to produce an implementation plan only. Do NOT modify any files yet.

Explore the repository as needed, then output the plan as your final message, formatted exactly like this:

## Plan

1. <step>
2. <step>
...

## Files likely touched

- <path> — <why>

## Risks

- <anything that could go wrong or needs the maintainer's judgment>

Keep the plan concrete and scoped to the request. Do not include preamble before "## Plan".`;
}

export function buildPrompt(plan: string): string {
  return `Your plan was approved by the maintainer. Implement it now.

The approved plan:

${plan}

Rules:
- Work only inside this repository checkout.
- Follow the existing code style and conventions.
- Run the project's tests/typecheck if a fast command exists (check package.json / Makefile).
- Do NOT run git commit or git push; the harness handles version control.
- When you are done, summarize what you changed in your final message: one line per file, then a short paragraph suitable for a pull request description.`;
}

export function revisePrompt(feedback: string): string {
  return `The maintainer reviewed your plan and wants changes before approving:

${feedback}

Revise the plan and output the full updated plan in the same format ("## Plan", "## Files likely touched", "## Risks"). Do not modify any files.`;
}

export function reviewPrompt(prTitle: string, prBody: string, diff: string, instructions: string): string {
  return `You are Alex, reviewing a pull request in this repository checkout.

PR title: ${prTitle}
PR description:
${prBody || "(empty)"}

${instructions ? `The maintainer asked you to focus on: ${instructions}\n` : ""}
The diff:

\`\`\`diff
${diff}
\`\`\`

Explore the surrounding code as needed to judge correctness, not just style.

Output your review as your final message:
- Start with a one-paragraph verdict.
- Then "### Findings" as a numbered list; for each: severity (blocker/major/minor/nit), file:line, what is wrong, and a concrete fix.
- If the change looks good, say so plainly and list at most a couple of optional improvements.`;
}

export function planCommentBody(plan: string, appSlug: string): string {
  return `${plan}

---
**Approve this plan** with a 👍 reaction, or reply \`@${appSlug} approve\`. Reply with feedback to request changes, or \`@${appSlug} stop\` to cancel.`;
}
