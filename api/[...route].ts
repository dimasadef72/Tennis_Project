import app from '../src'

export default (req: Request) => {
  const url = new URL(req.url)

  if (url.pathname.startsWith('/api/')) {
    url.pathname = url.pathname.slice(4)
  }

  return app.fetch(new Request(url, req))
}
