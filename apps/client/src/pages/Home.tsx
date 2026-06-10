import { useEffect } from 'react'
import type { App } from '../../../server/src'
import { treaty } from '@elysia/eden'

const app = treaty<App>('localhost:5007')

function Home() {

  useEffect(() => {
    app.get().then(({ data }) => {
      console.log(data)
    })
  }, [])

  return (
    <div className="home">
      <h1>Excuse</h1>
      <p>让想象力拥有生产力。</p>
    </div>
  )
}

export default Home
