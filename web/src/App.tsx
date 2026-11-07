import { Footer, MissingInputs, TopNav } from './components/Shell'
import { fromQuery } from './lib/inputs'
import { useRoute } from './router'
import { Attempts } from './screens/Attempts'
import { Entry } from './screens/Entry'
import { Share } from './screens/Share'
import { Verdict } from './screens/Verdict'
import { WeightClass } from './screens/WeightClass'

export default function App() {
  const { path, params } = useRoute()
  const inputs = fromQuery(params)

  if (path === '/' || path === '') return <Entry initial={inputs} />

  const screens = {
    '/v': ['verdict', Verdict],
    '/wc': ['weight-class', WeightClass],
    '/at': ['attempts', Attempts],
    '/share': ['verdict', Share],
  } as const
  const hit = screens[path as keyof typeof screens]
  if (!hit) return <Entry initial={inputs} />
  const [active, Screen] = hit

  return (
    <div className="page">
      <TopNav active={active} inputs={inputs} />
      {inputs ? <Screen inputs={inputs} params={params} /> : <main className="main"><MissingInputs /></main>}
      <Footer />
    </div>
  )
}
