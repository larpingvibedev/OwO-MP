import { useNavigate } from 'react-router-dom';
import { LocalFilesView } from '../components/local/LocalFilesView';

export function LocalFiles() {
  const navigate = useNavigate();

  return (
    <div className="page-container" style={{ padding: '24px 32px' }}>
      <LocalFilesView embedded={false} onBack={() => navigate(-1)} />
    </div>
  );
}
