// Backward-compat shim — new code uses StudyCapturePanel with a StudyConfig.
import StudyCapturePanel from './StudyCapturePanel';
import { STUDIES } from '../data/studies';

interface Props {
  contactId: string;
}

const ELBOW = STUDIES['elbow-study-participant'];

export default function ElbowStudyPanel({ contactId }: Props) {
  return <StudyCapturePanel contactId={contactId} study={ELBOW} />;
}
