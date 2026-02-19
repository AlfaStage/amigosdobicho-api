import { AdminLayout } from './AdminLayout'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'

export default function PlaceholderPage({ name }: { name: string }) {
    return (
        <AdminLayout title={name} description="Página em construção Brutalista">
            <Card>
                <CardHeader>
                    <CardTitle>Espere um pouco!</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="font-bold">Esta página está sendo migrada para o novo sistema Shadcn Brutalist.</p>
                </CardContent>
            </Card>
        </AdminLayout>
    )
}
