import { fromQuery } from './lib/inputs'
import { useRoute } from './router'
import { Entry } from './screens/Entry'

// Screens land one commit at a time; until the first one does, every path is Entry.
export default function App() {
  const { params } = useRoute()
  return <Entry initial={fromQuery(params)} />
}
