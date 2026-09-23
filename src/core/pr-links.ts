/** Where a pull request's changed files are, on whichever site `url` points to. */
export function filesUrl(url: string): string {
  if (/\/pullrequest\/\d+$/i.test(url)) return `${url}?_a=files`
  return `${url}/files`
}
