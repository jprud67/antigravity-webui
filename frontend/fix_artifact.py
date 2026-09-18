import re

content = open('/root/antigravity-webui/frontend/src/components/ArtifactViewer.tsx', encoding='utf-8').read()

# I will just revert the prop interface to what it was.
# From:
# interface ArtifactViewerProps {
#   artifacts: ArtifactItem[];
#   onClose: () => void;
#   initialSelection?: ArtifactItem | null;
# }
# To:
# interface ArtifactViewerProps {
#   isOpen: boolean;
#   onClose: () => void;
#   conversationId?: string | null;
# }

content = re.sub(r"interface ArtifactViewerProps \{[^\}]+\}", 
"""interface ArtifactViewerProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId?: string | null;
}""", content)

# And export const ArtifactViewer: React.FC<ArtifactViewerProps> = ({ artifacts, onClose, initialSelection }) => {
# To export const ArtifactViewer: React.FC<ArtifactViewerProps> = ({ isOpen, onClose, conversationId }) => {

content = re.sub(r"export const ArtifactViewer: React\.FC<ArtifactViewerProps> = \(\{\s*artifacts,\s*onClose,\s*initialSelection\s*\}\) => \{",
"""export const ArtifactViewer: React.FC<ArtifactViewerProps> = ({
  isOpen,
  onClose,
  conversationId
}) => {""", content)

# I also need to restore the state for artifacts:
# const [selectedArtifact, setSelectedArtifact] = useState<ArtifactItem | null>(initialSelection || null);
# to
# const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
# const [selectedArtifact, setSelectedArtifact] = useState<ArtifactItem | null>(null);

content = content.replace("const [selectedArtifact, setSelectedArtifact] = useState<ArtifactItem | null>(initialSelection || null);",
"const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);\n  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactItem | null>(null);")

# And showMobileList
content = content.replace("const [showMobileList, setShowMobileList] = useState<boolean>(!initialSelection);",
"const [showMobileList, setShowMobileList] = useState<boolean>(false);")

# Now I need to inject the fetchArtifacts effect back:
effect = """
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetchArtifacts(conversationId || undefined).then((items) => {
      if (active) {
        setArtifacts(items);
        if (items.length > 0) {
          setSelectedArtifact(items[0]);
        } else {
          setSelectedArtifact(null);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [isOpen, conversationId]);

"""

content = content.replace("const [showMobileList, setShowMobileList] = useState<boolean>(false);",
"const [showMobileList, setShowMobileList] = useState<boolean>(false);\n" + effect)

# Fix rendering if !isOpen
content = content.replace("return (\n    <div className=\"fixed", "if (!isOpen) return null;\n\n  return (\n    <div className=\"fixed")

with open('/root/antigravity-webui/frontend/src/components/ArtifactViewer.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
