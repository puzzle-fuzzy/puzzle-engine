import type { App } from '../../../server/src'
import { treaty } from '@elysia/eden'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

const app = treaty<App>('localhost:5007')

function Home() {
  useEffect(() => {
    app.api.health.get().then(({ data }) => {
      console.log(data)
    })
  }, [])

  return (
    <div className="home">
      <h1>Excuse</h1>
      <p>让想象力拥有生产力。</p>
      <Button>Click me</Button>
    </div>
  )
}

export default Home
