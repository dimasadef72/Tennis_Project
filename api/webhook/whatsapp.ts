import app from '../../src'

export default (req: Request) => {
  const url = new URL(req.url)
  url.pathname = '/webhook/whatsapp'

  return app.fetch(new Request(url, req))
}
