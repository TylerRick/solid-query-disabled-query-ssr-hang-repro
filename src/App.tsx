import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/solid-query';

const client = new QueryClient();
const enabled = process.env.ENABLED === '1';

function Inner() {
	const q = useQuery(() => ({
		queryKey: ['disabled'],
		queryFn: async () => 'data',
		enabled,
	}));
	// Reading .data during render is what the v5 issue (#10907) identified as the trigger.
	return <div id="out">data: {String(q.data)}</div>;
}

export default function App() {
	return (
		<QueryClientProvider client={client}>
			<Inner />
		</QueryClientProvider>
	);
}
